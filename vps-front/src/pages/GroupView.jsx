import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";
import DeploymentWizard from "../components/DeploymentWizard";
import EditEnvModal from "../components/EditEnvModal";
import FileManagerModal from "../components/FileManagerModal";
import ExecuteScriptModal from "../components/ExecuteScriptModal";
import CreateDatabaseModal from "../components/CreateDatabaseModal";
import LogViewerModal from "../components/LogViewerModal";

const BASE_DOMAIN = import.meta.env.VITE_BASE_DOMAIN || "93.127.199.118.sslip.io";
const BASE_PORT = import.meta.env.VITE_PORT ? `:${import.meta.env.VITE_PORT}` : "";

export default function GroupView() {
    const { groupId } = useParams();
    const nav = useNavigate();
    const [group, setGroup] = useState(null);
    const [err, setErr] = useState("");

    // Wizard states
    const [showWizard, setShowWizard] = useState(false);
    const [wizardRole, setWizardRole] = useState(null); // 'FRONTEND' or 'BACKEND'
    const [wizardProject, setWizardProject] = useState(null); // For editing/redeploying existing project
    const [showDbModal, setShowDbModal] = useState(false);

    // Action states
    const [deletingComponent, setDeletingComponent] = useState(null); // 'frontend', 'backend', 'database'
    const [redeployingComponent, setRedeployingComponent] = useState(null);
    const [editingEnvProjectId, setEditingEnvProjectId] = useState(null);
    const [managingFilesProjectId, setManagingFilesProjectId] = useState(null);
    const [managingStorage, setManagingStorage] = useState(false); // For storage mode file manager
    const [executingScriptProjectId, setExecutingScriptProjectId] = useState(null);
    
    // Log Viewer State
    const [viewingLogsDeploymentId, setViewingLogsDeploymentId] = useState(null);

    // Messages
    const [message, setMessage] = useState(null);
    const messageTimeoutRef = useRef(null);

    useEffect(() => {
        if (!getToken()) {
            nav("/login");
            return;
        }
        fetchGroup();
    }, [groupId, nav]);

    useEffect(() => {
        return () => {
            if (messageTimeoutRef.current) {
                clearTimeout(messageTimeoutRef.current);
            }
        };
    }, []);

    const showMessage = (type, text, timeoutMs = 4000) => {
        setMessage({ type, text });
        if (messageTimeoutRef.current) clearTimeout(messageTimeoutRef.current);
        messageTimeoutRef.current = setTimeout(() => {
            setMessage(null);
        }, timeoutMs);
    };

    const fetchGroup = async () => {
        try {
            // Use new GET /api/groups/:id endpoint
            const g = await apiFetch(`/groups/${groupId}`, { token: getToken() });
            setGroup(g);
        } catch (e) {
            setErr(e.message);
        }
    };

    // Delete a component (frontend/backend)
    const deleteComponent = async (projectId, componentType) => {
        const confirmed = window.confirm(
            `Delete ${componentType}?\n\nThis will permanently remove the ${componentType} and all its data.`
        );
        if (!confirmed) return;

        setDeletingComponent(componentType);
        try {
            await apiFetch(`/projects/${projectId}`, {
                method: "DELETE",
                token: getToken()
            });
            showMessage("success", `${componentType} deleted successfully`);
            fetchGroup();
        } catch (e) {
            showMessage("error", `Failed to delete: ${e.message}`);
        } finally {
            setDeletingComponent(null);
        }
    };

    // Delete database
    const deleteDatabase = async (databaseId) => {
        const confirmed = window.confirm(
            `Delete database?\n\nThis will permanently delete all data. This action cannot be undone.`
        );
        if (!confirmed) return;

        setDeletingComponent("database");
        try {
            await apiFetch(`/databases/${databaseId}`, {
                method: "DELETE",
                token: getToken()
            });
            showMessage("success", "Database deleted successfully");
            fetchGroup();
        } catch (e) {
            showMessage("error", `Failed to delete database: ${e.message}`);
        } finally {
            setDeletingComponent(null);
        }
    };

    // Redeploy component
    // skipConfirm: when called from EditEnvModal, skip the confirm dialog
    const redeployComponent = async (projectId, componentType, skipConfirm = false) => {
        if (!skipConfirm) {
            const confirmed = window.confirm(`Redeploy ${componentType}?`);
            if (!confirmed) return;
        }

        setRedeployingComponent(componentType);
        try {
            const result = await apiFetch(`/deployments/${projectId}/redeploy`, {
                method: "POST",
                token: getToken()
            });
            
            // Open log viewer immediately
            setViewingLogsDeploymentId(result.deploymentId);
            
            // Refresh group data to show new deployment in UI
            fetchGroup();
            
            // Poll in background to update status when modal is closed
            pollDeploymentStatus(result.deploymentId, componentType);
        } catch (e) {
            showMessage("error", `Failed to start redeployment: ${e.message}`);
            setRedeployingComponent(null);
        }
    };

    const pollDeploymentStatus = async (deploymentId, componentType) => {
        let pollCount = 0;
        const maxPolls = 150; // 5 minutes max (150 * 2 seconds)

        const pollInterval = setInterval(async () => {
            pollCount++;

            // Timeout after max polls
            if (pollCount >= maxPolls) {
                clearInterval(pollInterval);
                setRedeployingComponent(null);
                // Don't show error if user is still viewing logs (modal handles it)
                fetchGroup();
                return;
            }

            try {
                const deployment = await apiFetch(`/deployments/status/${deploymentId}`, {
                    token: getToken()
                });

                if (deployment.status === "DEPLOYED" || deployment.status === "FAILED") {
                    clearInterval(pollInterval);
                    setRedeployingComponent(null);
                    if (deployment.status === "DEPLOYED") {
                        showMessage("success", `${componentType} redeployed successfully!`);
                    } else {
                        showMessage("error", `${componentType} redeployment failed!`);
                    }
                    fetchGroup();
                }
            } catch (e) {
                clearInterval(pollInterval);
                setRedeployingComponent(null);
            }
        }, 2000);
    };

    const openConfigureWizard = (project, role) => {
        setWizardRole(role);
        setWizardProject(project);
        setShowWizard(true);
    };

    if (err) return <div style={{ padding: 40, textAlign: "center" }}>Error: {err}</div>;
    if (!group) return <div style={{ padding: 40 }}>Loading...</div>;

    const rawProjectUrl = group.url || (group.slug ? `http://${group.slug}.${BASE_DOMAIN}` : null);
    const projectUrl = rawProjectUrl && BASE_PORT && /^https?:\/\//.test(rawProjectUrl) && !/:\d+(\/|$)/.test(rawProjectUrl.replace(/^https?:\/\//, ""))
        ? rawProjectUrl.replace(/^(https?:\/\/[^/]+)/, `$1${BASE_PORT}`)
        : (rawProjectUrl ? `${rawProjectUrl}${rawProjectUrl.includes("://") ? "" : BASE_PORT}` : null);
    const projectUrlText = projectUrl ? projectUrl.replace(/^https?:\/\//, "") : "";
    const apiPrefix = group.apiPathPrefix || "/api";
    const apiUrl = projectUrl ? `${projectUrl}${apiPrefix.startsWith("/") ? apiPrefix : `/${apiPrefix}`}` : null;
    const apiUrlText = apiUrl ? apiUrl.replace(/^https?:\/\//, "") : "";

    return (
        <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
            {/* Back button */}
            <div style={{ marginBottom: 20 }}>
                <button onClick={() => nav("/dashboard")} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}>
                    ← Back to Dashboard
                </button>
            </div>

            {/* Project Header */}
            <div style={{ marginBottom: 30 }}>
                <h1 style={{ margin: "0 0 8px 0" }}>{group.name}</h1>
                {projectUrl && (
                    <div style={{ display: "flex", alignItems: "center", gap: 15, color: "#666" }}>
                        <span>
                            URL: <a href={projectUrl} target="_blank" rel="noreferrer" style={{ color: "#2196F3" }}>
                                {projectUrlText}
                            </a>
                        </span>
                        <span>|</span>
                        <span>API Prefix: <code style={{ background: "#f5f5f5", padding: "2px 6px", borderRadius: 4 }}>{group.apiPathPrefix || "/api"}</code></span>
                    </div>
                )}
            </div>

            {/* Message */}
            {message && (
                <div style={{
                    marginBottom: 20,
                    padding: "12px 16px",
                    borderRadius: 8,
                    background: message.type === "success" ? "#e8f5e9" : "#ffebee",
                    color: message.type === "success" ? "#2e7d32" : "#c62828",
                    border: `1px solid ${message.type === "success" ? "#c8e6c9" : "#ffcdd2"}`
                }}>
                    {message.text}
                </div>
            )}

            {/* Deployment Wizard */}
            {showWizard && (
                <div style={{ marginBottom: 30, padding: 20, background: "#f9f9f9", borderRadius: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 15 }}>
                        <h3 style={{ margin: 0 }}>
                            {wizardProject ? `Configure ${wizardRole === "FRONTEND" ? "Frontend" : "Backend"}` : `Deploy ${wizardRole === "FRONTEND" ? "Frontend" : "Backend"}`}
                        </h3>
                        <button onClick={() => { setShowWizard(false); setWizardRole(null); setWizardProject(null); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2em" }}>×</button>
                    </div>
                    <DeploymentWizard
                        groupId={groupId}
                        role={wizardRole}
                        groupSlug={group.slug}
                        existingProject={wizardProject}
                        onComplete={() => {
                            setShowWizard(false);
                            setWizardRole(null);
                            setWizardProject(null);
                            fetchGroup();
                        }}
                    />
                </div>
            )}

            {/* Database Modal */}
            {showDbModal && (
                <CreateDatabaseModal
                    groupId={groupId}
                    groupSlug={group.slug}
                    onClose={() => setShowDbModal(false)}
                    onSuccess={() => {
                        setShowDbModal(false);
                        fetchGroup();
                    }}
                />
            )}

            {/* 3-Card Layout */}
            {!showWizard && (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
                    {/* Frontend Card */}
                    <ComponentCard
                        title="Frontend"
                        icon="🌐"
                        component={group.frontend}
                        hasComponent={group.hasFrontend}
                        isDeleting={deletingComponent?.toLowerCase() === "frontend"}
                        isRedeploying={redeployingComponent?.toLowerCase() === "frontend"}
                        onAdd={() => { setWizardRole("FRONTEND"); setWizardProject(null); setShowWizard(true); }}
                        onDelete={() => deleteComponent(group.frontend?.id, "Frontend")}
                        onRedeploy={() => redeployComponent(group.frontend?.id, "Frontend")}
                        onConfigure={() => openConfigureWizard(group.frontend, "FRONTEND")}
                        onViewLogs={() => setViewingLogsDeploymentId(group.frontend?.latestDeployment?.id)}
                        onManageFiles={() => {
                            if (group.frontend?.id) {
                                setManagingFilesProjectId(group.frontend.id);
                            }
                        }}
                        onEditEnv={() => setEditingEnvProjectId(group.frontend?.id)}
                        url={projectUrl}
                        urlText={projectUrlText}
                    />

                    {/* Backend Card */}
                    <ComponentCard
                        title="Backend"
                        icon="⚙️"
                        component={group.backend}
                        hasComponent={group.hasBackend}
                        isDeleting={deletingComponent?.toLowerCase() === "backend"}
                        isRedeploying={redeployingComponent?.toLowerCase() === "backend"}
                        onAdd={() => { setWizardRole("BACKEND"); setWizardProject(null); setShowWizard(true); }}
                        onDelete={() => deleteComponent(group.backend?.id, "Backend")}
                        onRedeploy={() => redeployComponent(group.backend?.id, "Backend")}
                        onConfigure={() => openConfigureWizard(group.backend, "BACKEND")}
                        onViewLogs={() => setViewingLogsDeploymentId(group.backend?.latestDeployment?.id)}
                        onManageFiles={() => {
                            if (group.backend?.id) {
                                setManagingFilesProjectId(group.backend.id);
                            }
                        }}
                        onManageStorage={() => setManagingStorage(true)}
                        showManageStorage={!!group.backend?.staticFolder}
                        onEditEnv={() => setEditingEnvProjectId(group.backend?.id)}
                        onExecuteScript={() => setExecutingScriptProjectId(group.backend?.id)}
                        showExecuteScript
                        url={apiUrl}
                        urlText={apiUrlText}
                    />

                    {/* Database Card */}
                    <DatabaseCard
                        database={group.database}
                        hasDatabase={group.hasDatabase}
                        databaseInfo={group.databaseInfo}
                        isDeleting={deletingComponent?.toLowerCase() === "database"}
                        onAdd={() => setShowDbModal(true)}
                        onDelete={() => deleteDatabase(group.database?.id)}
                        onManage={() => nav(`/databases/${group.database?.id}?groupId=${groupId}`)}
                    />
                </div>
            )}

            {/* Modals */}
            {viewingLogsDeploymentId && (
                <LogViewerModal
                    deploymentId={viewingLogsDeploymentId}
                    onClose={() => setViewingLogsDeploymentId(null)}
                    onComplete={() => fetchGroup()}
                />
            )}

            {editingEnvProjectId && (() => {
                const isFrontend = group.frontend?.id === editingEnvProjectId;
                const componentType = isFrontend ? "Frontend" : "Backend";
                return (
                    <EditEnvModal
                        projectId={editingEnvProjectId}
                        projectName={componentType}
                        onClose={() => setEditingEnvProjectId(null)}
                        onSuccess={fetchGroup}
                        onRedeploy={() => {
                            setEditingEnvProjectId(null); // Close modal first
                            redeployComponent(editingEnvProjectId, componentType, true); // skipConfirm=true
                        }}
                    />
                );
            })()}

            {managingFilesProjectId && (() => {
                const isFrontend = group.frontend?.id === managingFilesProjectId;
                const rootDir = isFrontend ? group.frontend?.rootDir : group.backend?.rootDir;
                // Normalize: "/" or empty means repo root (empty string for file manager)
                const initialPath = (!rootDir || rootDir === "/") ? "" : rootDir.replace(/^\//, "");
                return (
                    <FileManagerModal
                        key={managingFilesProjectId}
                        projectId={managingFilesProjectId}
                        projectName={isFrontend ? "Frontend" : "Backend"}
                        initialPath={initialPath}
                        onClose={() => setManagingFilesProjectId(null)}
                    />
                );
            })()}

            {/* Storage File Manager - for persistent storage that survives redeployments */}
            {managingStorage && group.backend?.staticFolder && (
                <FileManagerModal
                    key="storage-manager"
                    storageMode={true}
                    groupId={groupId}
                    storageFolder={group.backend.staticFolder}
                    projectName="Backend Storage"
                    onClose={() => setManagingStorage(false)}
                />
            )}

            {executingScriptProjectId && (
                <ExecuteScriptModal
                    projectId={executingScriptProjectId}
                    projectName="Backend"
                    onClose={() => setExecutingScriptProjectId(null)}
                />
            )}
        </div>
    );
}

// Component Card (for Frontend/Backend)
function ComponentCard({
    title,
    icon,
    component,
    hasComponent,
    isDeleting,
    isRedeploying,
    onAdd,
    onDelete,
    onRedeploy,
    onConfigure,
    onViewLogs,
    onManageFiles,
    onManageStorage,
    onEditEnv,
    onExecuteScript,
    showExecuteScript,
    showManageStorage,
    url,
    urlText
}) {
    const [menuOpen, setMenuOpen] = useState(false);

    const getStatusStyle = (status) => {
        const styles = {
            "DEPLOYED": { bg: "#e8f5e9", color: "#2e7d32", text: "Deployed" },
            "BUILDING": { bg: "#e3f2fd", color: "#1565c0", text: "Building" },
            "FAILED": { bg: "#ffebee", color: "#c62828", text: "Failed" },
            "IDLE": { bg: "#f5f5f5", color: "#757575", text: "Idle" }
        };
        return styles[status] || styles.IDLE;
    };

    if (!hasComponent) {
        return (
            <div style={{
                border: "2px dashed #ddd",
                borderRadius: 12,
                padding: 30,
                textAlign: "center",
                background: "#fafafa"
            }}>
                <div style={{ fontSize: "2em", marginBottom: 10 }}>{icon}</div>
                <h3 style={{ margin: "0 0 10px 0", color: "#666" }}>{title}</h3>
                <p style={{ color: "#999", fontSize: "0.9em", marginBottom: 15 }}>Not deployed</p>
                <button
                    onClick={onAdd}
                    style={{
                        background: "#2196F3",
                        color: "white",
                        border: "none",
                        padding: "10px 20px",
                        borderRadius: 6,
                        cursor: "pointer"
                    }}
                >
                    + Add {title}
                </button>
            </div>
        );
    }

    const status = getStatusStyle(component?.deploymentStatus);

    return (
        <div style={{
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            padding: 20,
            background: "white",
            position: "relative"
        }}>
            {/* Loading overlay */}
            {(isDeleting || isRedeploying) && (
                <div style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(255,255,255,0.95)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 12,
                    zIndex: 10,
                    backdropFilter: "blur(2px)"
                }}>
                    <div className={`spinner-lg ${isDeleting ? "spinner-danger" : ""}`}></div>
                    <span className="loading-text" style={{
                        marginTop: 12,
                        color: isDeleting ? "#c62828" : "#2196F3",
                        fontWeight: 500,
                        fontSize: "0.95em"
                    }}>
                        {isDeleting ? "Deleting..." : "Redeploying..."}
                    </span>
                    {/* Add View Logs button here if redeploying */}
                    {isRedeploying && onViewLogs && component?.latestDeployment && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onViewLogs(); }}
                            style={{
                                marginTop: 10,
                                background: "#e3f2fd",
                                color: "#1565c0",
                                border: "none",
                                padding: "6px 12px",
                                borderRadius: 4,
                                fontSize: "0.85em",
                                cursor: "pointer"
                            }}
                        >
                            View Logs
                        </button>
                    )}
                </div>
            )}

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 15 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: "1.5em" }}>{icon}</span>
                    <h3 style={{ margin: 0 }}>{title}</h3>
                </div>
                <div style={{ position: "relative" }}>
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}
                    >⋮</button>
                    {menuOpen && (
                        <div style={{
                            position: "absolute",
                            right: 0,
                            top: "100%",
                            background: "white",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            minWidth: 160,
                            zIndex: 100
                        }}>
                            <MenuButton onClick={() => { setMenuOpen(false); onManageFiles(); }}>📂 Manage Files</MenuButton>
                            {showManageStorage && (
                                <MenuButton onClick={() => { setMenuOpen(false); onManageStorage(); }} color="#4CAF50">💾 Manage Storage</MenuButton>
                            )}
                            <MenuButton onClick={() => { setMenuOpen(false); onEditEnv(); }}>⚙️ Environment</MenuButton>
                            {component?.latestDeployment && (
                                <MenuButton onClick={() => { setMenuOpen(false); onViewLogs(); }}>📜 View Logs</MenuButton>
                            )}
                            <MenuButton onClick={() => { setMenuOpen(false); onConfigure(); }}>🔧 Configure & Redeploy</MenuButton>
                            <MenuButton onClick={() => { setMenuOpen(false); onRedeploy(); }} color="#2196F3">🚀 Quick Redeploy</MenuButton>
                            {showExecuteScript && (
                                <MenuButton onClick={() => { setMenuOpen(false); onExecuteScript(); }}>▶️ Execute Script</MenuButton>
                            )}
                            <MenuButton onClick={() => { setMenuOpen(false); onDelete(); }} color="#c62828">🗑️ Delete</MenuButton>
                        </div>
                    )}
                </div>
            </div>

            {/* Status */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 15 }}>
                <div style={{
                    display: "inline-block",
                    padding: "4px 12px",
                    borderRadius: 20,
                    background: status.bg,
                    color: status.color,
                    fontSize: "0.85em",
                    fontWeight: 500
                }}>
                    {status.text}
                </div>
                
                {component?.deploymentStatus === "FAILED" && (
                    <button 
                        onClick={onConfigure}
                        style={{
                            background: "#c62828", color: "white", border: "none",
                            padding: "4px 12px", borderRadius: 20, fontSize: "0.8em", cursor: "pointer", fontWeight: 500
                        }}
                    >
                        ↻ Retry with Options
                    </button>
                )}
            </div>

            {/* Info */}
            <div style={{ fontSize: "0.9em", color: "#666" }}>
                {url && (
                    <div>
                        {(title === "Backend" ? "API URL" : "URL")}:{" "}
                        <a href={url} target="_blank" rel="noreferrer" style={{ color: "#2196F3" }}>
                            {urlText || url}
                        </a>
                    </div>
                )}
                {component?.framework && <div>Framework: {component.framework}</div>}
                {component?.port && <div>Port: {component.port}</div>}
            </div>
        </div>
    );
}

// Database Card
function DatabaseCard({ database, hasDatabase, databaseInfo, isDeleting, onAdd, onDelete, onManage }) {
    const [menuOpen, setMenuOpen] = useState(false);

    const getStatusStyle = (status) => {
        const styles = {
            "RUNNING": { bg: "#e8f5e9", color: "#2e7d32", text: "Running" },
            "CREATING": { bg: "#fff3e0", color: "#e65100", text: "Creating" },
            "STOPPED": { bg: "#f5f5f5", color: "#757575", text: "Stopped" },
            "ERROR": { bg: "#ffebee", color: "#c62828", text: "Error" },
            "FAILED": { bg: "#ffebee", color: "#c62828", text: "Failed" }
        };
        return styles[status] || { bg: "#f5f5f5", color: "#757575", text: status || "Unknown" };
    };

    if (!hasDatabase) {
        return (
            <div style={{
                border: "2px dashed #ddd",
                borderRadius: 12,
                padding: 30,
                textAlign: "center",
                background: "#fafafa"
            }}>
                <div style={{ fontSize: "2em", marginBottom: 10 }}>🗄️</div>
                <h3 style={{ margin: "0 0 10px 0", color: "#666" }}>Database</h3>
                <p style={{ color: "#999", fontSize: "0.9em", marginBottom: 15 }}>Not created</p>
                <button
                    onClick={onAdd}
                    style={{
                        background: "#673ab7",
                        color: "white",
                        border: "none",
                        padding: "10px 20px",
                        borderRadius: 6,
                        cursor: "pointer"
                    }}
                >
                    + Add Database
                </button>
            </div>
        );
    }

    const status = getStatusStyle(databaseInfo?.status || database?.status);

    return (
        <div style={{
            border: "1px solid #e0e0e0",
            borderRadius: 12,
            padding: 20,
            background: "white",
            position: "relative"
        }}>
            {isDeleting && (
                <div style={{
                    position: "absolute",
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(255,255,255,0.95)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 12,
                    zIndex: 10,
                    backdropFilter: "blur(2px)"
                }}>
                    <div className="spinner-lg spinner-danger"></div>
                    <span className="loading-text" style={{
                        marginTop: 12,
                        color: "#c62828",
                        fontWeight: 500,
                        fontSize: "0.95em"
                    }}>
                        Deleting...
                    </span>
                </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 15 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: "1.5em" }}>🗄️</span>
                    <h3 style={{ margin: 0 }}>Database</h3>
                </div>
                <div style={{ position: "relative" }}>
                    <button
                        onClick={() => setMenuOpen(!menuOpen)}
                        style={{ background: "none", border: "1px solid #ddd", borderRadius: 4, padding: "4px 8px", cursor: "pointer" }}
                    >⋮</button>
                    {menuOpen && (
                        <div style={{
                            position: "absolute",
                            right: 0,
                            top: "100%",
                            background: "white",
                            border: "1px solid #ddd",
                            borderRadius: 6,
                            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                            minWidth: 160,
                            zIndex: 100
                        }}>
                            <MenuButton onClick={() => { setMenuOpen(false); onManage(); }}>📊 Manage</MenuButton>
                            <MenuButton onClick={() => { setMenuOpen(false); onDelete(); }} color="#c62828">🗑️ Delete</MenuButton>
                        </div>
                    )}
                </div>
            </div>

            <div style={{
                display: "inline-block",
                padding: "4px 12px",
                borderRadius: 20,
                background: status.bg,
                color: status.color,
                fontSize: "0.85em",
                fontWeight: 500,
                marginBottom: 15
            }}>
                {status.text}
            </div>

            <div style={{ fontSize: "0.9em", color: "#666" }}>
                <div>Type: {databaseInfo?.type || database?.type}</div>
            </div>

            <button
                onClick={onManage}
                style={{
                    marginTop: 15,
                    width: "100%",
                    padding: "8px",
                    background: "#673ab7",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer"
                }}
            >
                Open Database
            </button>
        </div>
    );
}

// Menu Button helper
function MenuButton({ children, onClick, color }) {
    return (
        <button
            onClick={onClick}
            style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 15px",
                background: "none",
                border: "none",
                borderBottom: "1px solid #eee",
                cursor: "pointer",
                fontSize: "0.9em",
                color: color || "inherit"
            }}
            onMouseEnter={e => e.target.style.background = "#f5f5f5"}
            onMouseLeave={e => e.target.style.background = "none"}
        >
            {children}
        </button>
    );
}
