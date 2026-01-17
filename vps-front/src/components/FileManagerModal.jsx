import { useEffect, useState, useRef } from "react";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";

export default function FileManagerModal({ projectId, projectName, initialPath = "", onClose }) {
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [navigating, setNavigating] = useState(false); // Separate state for folder navigation
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [uploading, setUploading] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState(new Set([initialPath]));
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [isVisible, setIsVisible] = useState(false); // For animation
    const fileInputRef = useRef(null);

    // Animate in on mount
    useEffect(() => {
        requestAnimationFrame(() => setIsVisible(true));
    }, []);

    useEffect(() => {
        fetchFiles(currentPath, items.length === 0); // Only show full loading on initial load
    }, [projectId, currentPath]);

    const fetchFiles = async (path, isInitialLoad = false) => {
        try {
            if (isInitialLoad) {
                setLoading(true);
            } else {
                setNavigating(true); // Use navigating for folder clicks - no layout shift
            }
            setError("");
            const data = await apiFetch(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`, {
                token: getToken()
            });
            setItems(data.items || []);
            setCurrentPath(data.currentPath || "/");
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
            setNavigating(false);
        }
    };

    const handleFolderClick = (folder) => {
        const isExpanded = expandedFolders.has(folder.path);
        const newExpanded = new Set(expandedFolders);

        if (isExpanded) {
            newExpanded.delete(folder.path);
        } else {
            newExpanded.add(folder.path);
        }

        setExpandedFolders(newExpanded);
        setCurrentPath(folder.path);
    };

    const handleUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e) => {
        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        setUploading(true);
        setError("");
        setSuccessMessage("");

        const formData = new FormData();
        files.forEach(file => {
            formData.append("files", file);
        });

        try {
            const apiBase = import.meta.env.VITE_API_BASE || "http://localhost:3000/api";
            const result = await fetch(
                `${apiBase}/projects/${projectId}/files/upload?path=${encodeURIComponent(currentPath)}`,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${getToken()}`
                    },
                    body: formData
                }
            );

            if (!result.ok) {
                const errData = await result.json();
                throw new Error(errData.error || "Upload failed");
            }

            const data = await result.json();
            setSuccessMessage(data.message || "Files uploaded successfully!");
            setTimeout(() => setSuccessMessage(""), 3000);
            fetchFiles(currentPath);
        } catch (e) {
            setError(e.message);
        } finally {
            setUploading(false);
            e.target.value = ""; // Reset file input
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;

        setCreatingFolder(true);
        setError("");

        try {
            await apiFetch(`/projects/${projectId}/files/mkdir`, {
                method: "POST",
                token: getToken(),
                body: {
                    path: currentPath,
                    name: newFolderName.trim()
                }
            });

            setSuccessMessage("Folder created successfully!");
            setTimeout(() => setSuccessMessage(""), 3000);
            setNewFolderName("");
            setShowNewFolderInput(false);
            fetchFiles(currentPath);
        } catch (e) {
            setError(e.message);
        } finally {
            setCreatingFolder(false);
        }
    };

    const handleDelete = async (item) => {
        const confirmed = window.confirm(
            `Delete "${item.name}"?\n\n` +
            `This will permanently remove this ${item.type}.` +
            (item.type === "folder" ? "\n\nAll contents will be deleted!" : "") +
            "\n\nThis action cannot be undone."
        );

        if (!confirmed) return;

        try {
            setError("");
            await apiFetch(`/projects/${projectId}/files?path=${encodeURIComponent(item.path)}`, {
                method: "DELETE",
                token: getToken()
            });

            setSuccessMessage(`${item.type} deleted successfully!`);
            setTimeout(() => setSuccessMessage(""), 3000);
            fetchFiles(currentPath);
        } catch (e) {
            setError(e.message);
        }
    };

    const handleBreadcrumbClick = (path) => {
        setCurrentPath(path);
    };

    const formatSize = (bytes) => {
        if (!bytes) return "-";
        if (bytes < 1024) return bytes + " B";
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
        return (bytes / (1024 * 1024)).toFixed(1) + " MB";
    };

    const renderBreadcrumbs = () => {
        const parts = currentPath === "/" ? [] : currentPath.split("/").filter(Boolean);

        return (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 15, fontSize: "0.9em" }}>
                <button
                    onClick={() => handleBreadcrumbClick("")}
                    style={{
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: currentPath === "/" ? "#2196F3" : "#666",
                        textDecoration: currentPath === "/" ? "underline" : "none",
                        padding: "2px 5px"
                    }}
                >
                    📁 Root
                </button>
                {parts.map((part, idx) => {
                    const path = parts.slice(0, idx + 1).join("/");
                    const isLast = idx === parts.length - 1;
                    return (
                        <span key={idx} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{ color: "#999" }}>/</span>
                            <button
                                onClick={() => !isLast && handleBreadcrumbClick(path)}
                                style={{
                                    background: "none",
                                    border: "none",
                                    cursor: isLast ? "default" : "pointer",
                                    color: isLast ? "#2196F3" : "#666",
                                    textDecoration: isLast ? "underline" : "none",
                                    padding: "2px 5px"
                                }}
                            >
                                {part}
                            </button>
                        </span>
                    );
                })}
            </div>
        );
    };

    const handleClose = () => {
        setIsVisible(false);
        setTimeout(onClose, 150); // Wait for animation to complete
    };

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: isVisible ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 2000,
                transition: "background 0.15s ease-out"
            }}
            onClick={handleClose}
        >
            <div
                style={{
                    background: "white",
                    borderRadius: 12,
                    padding: 0,
                    maxWidth: 900,
                    width: "90%",
                    maxHeight: "85vh",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
                    transform: isVisible ? "scale(1)" : "scale(0.95)",
                    opacity: isVisible ? 1 : 0,
                    transition: "transform 0.15s ease-out, opacity 0.15s ease-out"
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: "20px 30px",
                    borderBottom: "1px solid #eee",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center"
                }}>
                    <div>
                        <h2 style={{ margin: 0 }}>📂 File Manager</h2>
                        <p style={{ margin: "5px 0 0 0", fontSize: "0.85em", color: "#666" }}>
                            Project: <strong>{projectName}</strong>
                        </p>
                    </div>
                    <button
                        onClick={handleClose}
                        style={{
                            background: "none",
                            border: "none",
                            fontSize: "1.5em",
                            cursor: "pointer",
                            color: "#666"
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Messages */}
                <div style={{ padding: "0 30px" }}>
                    {error && (
                        <div style={{ marginTop: 15, padding: 12, background: "#ffebee", color: "#c62828", borderRadius: 6, fontSize: "0.9em" }}>
                            {error}
                        </div>
                    )}

                    {successMessage && (
                        <div style={{ marginTop: 15, padding: 12, background: "#e8f5e9", color: "#2e7d32", borderRadius: 6, fontSize: "0.9em" }}>
                            ✓ {successMessage}
                        </div>
                    )}
                </div>

                {/* Toolbar */}
                <div style={{
                    padding: "15px 30px",
                    borderBottom: "1px solid #eee",
                    display: "flex",
                    gap: 10,
                    alignItems: "center"
                }}>
                    <button
                        onClick={handleUploadClick}
                        disabled={uploading}
                        style={{
                            background: "#2196F3",
                            color: "white",
                            border: "none",
                            padding: "8px 16px",
                            borderRadius: 6,
                            cursor: uploading ? "not-allowed" : "pointer",
                            fontSize: "0.9em",
                            opacity: uploading ? 0.7 : 1
                        }}
                    >
                        {uploading ? "Uploading..." : "📤 Upload Files"}
                    </button>
                    <button
                        onClick={() => setShowNewFolderInput(!showNewFolderInput)}
                        style={{
                            background: "#4CAF50",
                            color: "white",
                            border: "none",
                            padding: "8px 16px",
                            borderRadius: 6,
                            cursor: "pointer",
                            fontSize: "0.9em"
                        }}
                    >
                        📁 New Folder
                    </button>
                    <button
                        onClick={() => fetchFiles(currentPath)}
                        disabled={loading}
                        style={{
                            background: "#9E9E9E",
                            color: "white",
                            border: "none",
                            padding: "8px 16px",
                            borderRadius: 6,
                            cursor: loading ? "not-allowed" : "pointer",
                            fontSize: "0.9em",
                            opacity: loading ? 0.7 : 1
                        }}
                    >
                        🔄 Refresh
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        style={{ display: "none" }}
                    />
                </div>

                {/* New Folder Input */}
                {showNewFolderInput && (
                    <div style={{
                        padding: "15px 30px",
                        background: "#f5f5f5",
                        borderBottom: "1px solid #eee",
                        display: "flex",
                        gap: 10,
                        alignItems: "center"
                    }}>
                        <input
                            type="text"
                            placeholder="Folder name"
                            value={newFolderName}
                            onChange={e => setNewFolderName(e.target.value)}
                            onKeyPress={e => e.key === "Enter" && handleCreateFolder()}
                            autoFocus
                            style={{
                                flex: 1,
                                padding: "8px 12px",
                                border: "1px solid #ddd",
                                borderRadius: 4,
                                fontSize: "0.9em"
                            }}
                        />
                        <button
                            onClick={handleCreateFolder}
                            disabled={creatingFolder || !newFolderName.trim()}
                            style={{
                                background: "#4CAF50",
                                color: "white",
                                border: "none",
                                padding: "8px 16px",
                                borderRadius: 6,
                                cursor: (creatingFolder || !newFolderName.trim()) ? "not-allowed" : "pointer",
                                fontSize: "0.9em"
                            }}
                        >
                            Create
                        </button>
                        <button
                            onClick={() => {
                                setShowNewFolderInput(false);
                                setNewFolderName("");
                            }}
                            style={{
                                background: "none",
                                border: "1px solid #ddd",
                                padding: "8px 16px",
                                borderRadius: 6,
                                cursor: "pointer",
                                fontSize: "0.9em"
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                )}

                {/* Breadcrumbs */}
                <div style={{ padding: "15px 30px", borderBottom: "1px solid #eee" }}>
                    {renderBreadcrumbs()}
                </div>

                {/* File List */}
                <div style={{
                    flex: 1,
                    overflow: "auto",
                    padding: "20px 30px",
                    position: "relative",
                    minHeight: 200
                }}>
                    {/* Navigating overlay - subtle, doesn't replace content */}
                    {navigating && (
                        <div style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            background: "rgba(255,255,255,0.7)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            zIndex: 5,
                            borderRadius: 8
                        }}>
                            <span style={{ color: "#666" }}>Loading...</span>
                        </div>
                    )}
                    {loading ? (
                        <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
                            Loading files...
                        </div>
                    ) : items.length === 0 ? (
                        <div style={{
                            textAlign: "center",
                            padding: 40,
                            color: "#999",
                            fontStyle: "italic"
                        }}>
                            This folder is empty. Upload files or create a new folder to get started.
                        </div>
                    ) : (
                        <div style={{
                            border: "1px solid #eee",
                            borderRadius: 8,
                            overflow: "hidden"
                        }}>
                            {/* Header Row */}
                            <div style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 120px 80px",
                                gap: 15,
                                padding: "12px 15px",
                                background: "#f9f9f9",
                                borderBottom: "1px solid #eee",
                                fontWeight: 600,
                                fontSize: "0.85em",
                                color: "#666"
                            }}>
                                <div>Name</div>
                                <div>Size</div>
                                <div>Actions</div>
                            </div>

                            {/* Items */}
                            {items.map((item, idx) => (
                                <div
                                    key={item.path}
                                    style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr 120px 80px",
                                        gap: 15,
                                        padding: "12px 15px",
                                        borderBottom: idx < items.length - 1 ? "1px solid #eee" : "none",
                                        background: selectedItem === item.path ? "#f5f5f5" : "white",
                                        cursor: item.type === "folder" ? "pointer" : "default"
                                    }}
                                    onClick={() => {
                                        if (item.type === "folder") {
                                            handleFolderClick(item);
                                        }
                                    }}
                                    onMouseEnter={() => setSelectedItem(item.path)}
                                    onMouseLeave={() => setSelectedItem(null)}
                                >
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize: "0.9em"
                                    }}>
                                        <span style={{ fontSize: "1.2em" }}>
                                            {item.type === "folder" ? "📁" : "📄"}
                                        </span>
                                        <span style={{
                                            color: item.type === "folder" ? "#2196F3" : "#333",
                                            fontWeight: item.type === "folder" ? 500 : 400
                                        }}>
                                            {item.name}
                                        </span>
                                    </div>
                                    <div style={{
                                        fontSize: "0.85em",
                                        color: "#999",
                                        display: "flex",
                                        alignItems: "center"
                                    }}>
                                        {item.type === "file" ? formatSize(item.size) : "-"}
                                    </div>
                                    <div style={{
                                        display: "flex",
                                        alignItems: "center"
                                    }}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDelete(item);
                                            }}
                                            style={{
                                                background: "none",
                                                border: "1px solid #ddd",
                                                padding: "4px 10px",
                                                borderRadius: 4,
                                                cursor: "pointer",
                                                fontSize: "0.8em",
                                                color: "#c62828"
                                            }}
                                        >
                                            🗑️ Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Info */}
                <div style={{
                    padding: "15px 30px",
                    borderTop: "1px solid #eee",
                    background: "#f9f9f9",
                    fontSize: "0.85em",
                    color: "#666"
                }}>
                    💡 <strong>Tip:</strong> After adding files that aren't in git (like uploads folders), use the "Redeploy" button to rebuild your project with the new files.
                </div>
            </div>
        </div>
    );
}
