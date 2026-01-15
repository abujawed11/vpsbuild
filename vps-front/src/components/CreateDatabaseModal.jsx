import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";

export default function CreateDatabaseModal({ onClose, onCreated }) {
    const nav = useNavigate();
    const [name, setName] = useState("");
    const [type, setType] = useState("MYSQL");
    const [projectId, setProjectId] = useState("");
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [failedDbId, setFailedDbId] = useState("");
    const [createdDb, setCreatedDb] = useState(null);
    const [copied, setCopied] = useState("");
    const [redeploying, setRedeploying] = useState(false);
    const [redeployMsg, setRedeployMsg] = useState("");

    useEffect(() => {
        // Fetch available projects for linking
        apiFetch("/projects", { token: getToken() })
            .then(res => {
                // Filter projects that don't already have a database
                const availableProjects = (res.projects || []).filter(p => !p.databaseId);
                setProjects(availableProjects);
            })
            .catch(console.error);
    }, []);

    const handleCreate = async () => {
        if (!name.trim()) {
            setError("Name is required");
            return;
        }

        setLoading(true);
        setError("");
        setFailedDbId("");

        try {
            const result = await apiFetch("/databases", {
                method: "POST",
                token: getToken(),
                body: {
                    name: name.trim(),
                    type,
                    projectId: projectId || undefined
                }
            });

            setCreatedDb({
                ...result.database,
                linkedProjectId: result.linkedProjectId || projectId || null,
                redeployRecommended: Boolean(result.redeployRecommended)
            });
        } catch (e) {
            setError(e.message);
            setFailedDbId(e?.data?.databaseId || "");
        } finally {
            setLoading(false);
        }
    };

    const copyToClipboard = (text, field) => {
        navigator.clipboard.writeText(text);
        setCopied(field);
        setTimeout(() => setCopied(""), 2000);
    };

    const downloadEnv = () => {
        if (!createdDb) return;
        const urlLines =
            createdDb.type === "MONGODB"
                ? `MONGO_URL=${createdDb.connectionUrl}\nDATABASE_URL=${createdDb.connectionUrl}\n`
                : `DATABASE_URL=${createdDb.connectionUrl}\n`;
        const content =
            urlLines +
            `DB_HOST=${createdDb.host}\nDB_PORT=${createdDb.port}\nDB_NAME=${createdDb.dbName}\nDB_USER=${createdDb.username}\nDB_PASSWORD=${createdDb.password}\n`;
        const blob = new Blob([content], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${createdDb.name.replace(/\s+/g, '-').toLowerCase()}.env`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Success screen after creation
    if (createdDb) {
        const linkedProject = createdDb.linkedProjectId
            ? projects.find(p => p.id === createdDb.linkedProjectId)
            : null;

        return (
            <div style={{
                position: "fixed",
                top: 0, left: 0, right: 0, bottom: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000
            }}>
                <div style={{
                    background: "white",
                    borderRadius: 12,
                    padding: 24,
                    width: "100%",
                    maxWidth: 500,
                    maxHeight: "90vh",
                    overflow: "auto"
                }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                        <h2 style={{ margin: 0, color: "#4caf50", display: "flex", alignItems: "center", gap: 8 }}>
                            ✓ Database Created!
                        </h2>
                        <button
                            onClick={() => onCreated(createdDb)}
                            style={{ background: "none", border: "none", fontSize: "1.5em", cursor: "pointer", color: "#999" }}
                        >
                            ×
                        </button>
                    </div>

                    <div style={{
                        background: "#fff3cd",
                        border: "1px solid #ffc107",
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 20
                    }}>
                        <strong style={{ color: "#856404" }}>⚠️ Save these credentials now!</strong>
                        <p style={{ margin: "8px 0 0 0", fontSize: "0.9em", color: "#856404" }}>
                            You won't be able to see the password again after closing this window.
                        </p>
                    </div>

                    {createdDb.linkedProjectId && (
                        <div style={{
                            background: "#e3f2fd",
                            border: "1px solid #90caf9",
                            borderRadius: 8,
                            padding: 12,
                            marginBottom: 16
                        }}>
                            <strong style={{ color: "#1565c0" }}>Linked to project</strong>
                            <div style={{ marginTop: 6, color: "#1565c0", fontSize: "0.9em" }}>
                                {linkedProject ? linkedProject.name : createdDb.linkedProjectId} (env vars updated)
                            </div>
                            <div style={{ display: "flex", gap: 10, marginTop: 10, alignItems: "center" }}>
                                <button
                                    disabled={redeploying}
                                    onClick={async () => {
                                        setRedeploying(true);
                                        setRedeployMsg("");
                                        try {
                                            const r = await apiFetch(`/deployments/${createdDb.linkedProjectId}/redeploy`, {
                                                method: "POST",
                                                token: getToken()
                                            });
                                            setRedeployMsg(`Redeploy queued (deploymentId: ${r.deploymentId})`);
                                        } catch (e) {
                                            setRedeployMsg(e.message);
                                        } finally {
                                            setRedeploying(false);
                                        }
                                    }}
                                    style={{
                                        background: redeploying ? "#90caf9" : "#2196F3",
                                        color: "white",
                                        padding: "8px 14px",
                                        borderRadius: 6,
                                        border: "none",
                                        cursor: redeploying ? "default" : "pointer"
                                    }}
                                >
                                    {redeploying ? "Redeploying..." : "Redeploy now"}
                                </button>
                                {redeployMsg && (
                                    <div style={{ fontSize: "0.85em", color: redeployMsg.startsWith("Redeploy queued") ? "#2e7d32" : "#c62828" }}>
                                        {redeployMsg}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    <div style={{ marginBottom: 16 }}>
                        <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>
                            Connection URL
                        </label>
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                readOnly
                                value={createdDb.connectionUrl}
                                style={{
                                    flex: 1,
                                    padding: 10,
                                    borderRadius: 6,
                                    border: "1px solid #ddd",
                                    fontFamily: "monospace",
                                    fontSize: "0.85em"
                                }}
                            />
                            <button
                                onClick={() => copyToClipboard(createdDb.connectionUrl, "url")}
                                style={{
                                    background: copied === "url" ? "#4caf50" : "#f0f0f0",
                                    color: copied === "url" ? "white" : "#333",
                                    border: "none",
                                    borderRadius: 6,
                                    padding: "0 12px",
                                    cursor: "pointer"
                                }}
                            >
                                {copied === "url" ? "✓" : "📋"}
                            </button>
                        </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                        <div>
                            <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>Host</label>
                            <div style={{ display: "flex", gap: 4 }}>
                                <input readOnly value={createdDb.host} style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontFamily: "monospace", fontSize: "0.85em" }} />
                                <button onClick={() => copyToClipboard(createdDb.host, "host")} style={{ background: copied === "host" ? "#4caf50" : "#f0f0f0", color: copied === "host" ? "white" : "#333", border: "none", borderRadius: 4, padding: "0 8px", cursor: "pointer", fontSize: "0.8em" }}>
                                    {copied === "host" ? "✓" : "📋"}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>Port</label>
                            <div style={{ display: "flex", gap: 4 }}>
                                <input readOnly value={createdDb.port} style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontFamily: "monospace", fontSize: "0.85em" }} />
                                <button onClick={() => copyToClipboard(String(createdDb.port), "port")} style={{ background: copied === "port" ? "#4caf50" : "#f0f0f0", color: copied === "port" ? "white" : "#333", border: "none", borderRadius: 4, padding: "0 8px", cursor: "pointer", fontSize: "0.8em" }}>
                                    {copied === "port" ? "✓" : "📋"}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>Database</label>
                            <div style={{ display: "flex", gap: 4 }}>
                                <input readOnly value={createdDb.dbName} style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontFamily: "monospace", fontSize: "0.85em" }} />
                                <button onClick={() => copyToClipboard(createdDb.dbName, "dbName")} style={{ background: copied === "dbName" ? "#4caf50" : "#f0f0f0", color: copied === "dbName" ? "white" : "#333", border: "none", borderRadius: 4, padding: "0 8px", cursor: "pointer", fontSize: "0.8em" }}>
                                    {copied === "dbName" ? "✓" : "📋"}
                                </button>
                            </div>
                        </div>
                        <div>
                            <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>Username</label>
                            <div style={{ display: "flex", gap: 4 }}>
                                <input readOnly value={createdDb.username} style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontFamily: "monospace", fontSize: "0.85em" }} />
                                <button onClick={() => copyToClipboard(createdDb.username, "username")} style={{ background: copied === "username" ? "#4caf50" : "#f0f0f0", color: copied === "username" ? "white" : "#333", border: "none", borderRadius: 4, padding: "0 8px", cursor: "pointer", fontSize: "0.8em" }}>
                                    {copied === "username" ? "✓" : "📋"}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                        <label style={{ display: "block", fontSize: "0.85em", color: "#666", marginBottom: 4 }}>Password</label>
                        <div style={{ display: "flex", gap: 8 }}>
                            <input
                                readOnly
                                value={createdDb.password}
                                style={{
                                    flex: 1,
                                    padding: 10,
                                    borderRadius: 6,
                                    border: "1px solid #ddd",
                                    fontFamily: "monospace",
                                    fontSize: "0.85em",
                                    background: "#fff8e1"
                                }}
                            />
                            <button
                                onClick={() => copyToClipboard(createdDb.password, "password")}
                                style={{
                                    background: copied === "password" ? "#4caf50" : "#f0f0f0",
                                    color: copied === "password" ? "white" : "#333",
                                    border: "none",
                                    borderRadius: 6,
                                    padding: "0 12px",
                                    cursor: "pointer"
                                }}
                            >
                                {copied === "password" ? "✓" : "📋"}
                            </button>
                        </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                        <button
                            onClick={downloadEnv}
                            style={{
                                background: "#f0f0f0",
                                color: "#333",
                                padding: "10px 20px",
                                borderRadius: 6,
                                border: "none",
                                cursor: "pointer"
                            }}
                        >
                            📥 Download .env
                        </button>
                        <button
                            onClick={() => onCreated(createdDb)}
                            style={{
                                background: "#2196F3",
                                color: "white",
                                padding: "10px 20px",
                                borderRadius: 6,
                                border: "none",
                                cursor: "pointer"
                            }}
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Creation form
    return (
        <div style={{
            position: "fixed",
            top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
        }}>
            <div style={{
                background: "white",
                borderRadius: 12,
                padding: 24,
                width: "100%",
                maxWidth: 450
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h2 style={{ margin: 0 }}>Create Managed Database</h2>
                    <button
                        onClick={onClose}
                        style={{ background: "none", border: "none", fontSize: "1.5em", cursor: "pointer", color: "#999" }}
                    >
                        ×
                    </button>
                </div>

                {error && (
                    <div style={{
                        background: "#ffebee",
                        color: "#c62828",
                        padding: 12,
                        borderRadius: 6,
                        marginBottom: 16,
                        fontSize: "0.9em"
                    }}>
                        <div>{error}</div>
                        {failedDbId && (
                            <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                                <button
                                    onClick={() => {
                                        onClose();
                                        nav(`/databases/${failedDbId}`);
                                    }}
                                    style={{
                                        background: "#c62828",
                                        color: "white",
                                        padding: "8px 12px",
                                        borderRadius: 6,
                                        border: "none",
                                        cursor: "pointer"
                                    }}
                                >
                                    View provisioning logs
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                        Database Name *
                    </label>
                    <input
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="my-app-database"
                        style={{
                            width: "100%",
                            padding: 10,
                            borderRadius: 6,
                            border: "1px solid #ddd",
                            fontSize: "1em",
                            boxSizing: "border-box"
                        }}
                        autoFocus
                    />
                </div>

                <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                        Database Type *
                    </label>
                    <div style={{ display: "flex", gap: 10 }}>
                        {[
                            { value: 'MYSQL', label: 'MySQL 8.0', icon: '🐬' },
                            { value: 'POSTGRES', label: 'PostgreSQL 15', icon: '🐘' },
                            { value: 'MONGODB', label: 'MongoDB 7', icon: '🍃' }
                        ].map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setType(opt.value)}
                                style={{
                                    flex: 1,
                                    padding: 12,
                                    borderRadius: 8,
                                    border: type === opt.value ? "2px solid #2196F3" : "1px solid #ddd",
                                    background: type === opt.value ? "#e3f2fd" : "white",
                                    cursor: "pointer",
                                    display: "flex",
                                    flexDirection: "column",
                                    alignItems: "center",
                                    gap: 4
                                }}
                            >
                                <span style={{ fontSize: "1.5em" }}>{opt.icon}</span>
                                <span style={{ fontSize: "0.85em" }}>{opt.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                    <label style={{ display: "block", marginBottom: 6, fontWeight: 500 }}>
                        Link to Project (Optional)
                    </label>
                    <select
                        value={projectId}
                        onChange={e => setProjectId(e.target.value)}
                        style={{
                            width: "100%",
                            padding: 10,
                            borderRadius: 6,
                            border: "1px solid #ddd",
                            fontSize: "1em",
                            boxSizing: "border-box"
                        }}
                    >
                        <option value="">-- None --</option>
                        {projects.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                    <p style={{ fontSize: "0.8em", color: "#666", margin: "8px 0 0 0" }}>
                        Linking adds DATABASE_URL to project's environment variables.
                    </p>
                    <p style={{ fontSize: "0.8em", color: "#666", margin: "6px 0 0 0" }}>
                        Credentials are generated automatically. Password is shown once after creation.
                    </p>
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button
                        onClick={onClose}
                        disabled={loading}
                        style={{
                            background: "#f0f0f0",
                            color: "#333",
                            padding: "10px 20px",
                            borderRadius: 6,
                            border: "none",
                            cursor: "pointer"
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreate}
                        disabled={loading || !name.trim()}
                        style={{
                            background: loading ? "#90caf9" : "#2196F3",
                            color: "white",
                            padding: "10px 20px",
                            borderRadius: 6,
                            border: "none",
                            cursor: loading ? "default" : "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: 8
                        }}
                    >
                        {loading && <span className="spinner-small"></span>}
                        {loading ? "Creating..." : "Create Database"}
                    </button>
                </div>
            </div>
        </div>
    );
}
