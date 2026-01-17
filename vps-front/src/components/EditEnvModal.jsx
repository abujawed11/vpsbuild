import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";

// Reserved environment variable keys that are system-managed
const RESERVED_KEYS = ['PORT', 'NODE_ENV', 'HOST'];

export default function EditEnvModal({ projectId, projectName, onClose, onSuccess, onRedeploy }) {
    const [envVars, setEnvVars] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [databases, setDatabases] = useState([]);
    const [dbLoading, setDbLoading] = useState(false);
    const [selectedDbId, setSelectedDbId] = useState("");
    const [linkingDb, setLinkingDb] = useState(false);

    useEffect(() => {
        fetchEnvVars();
        fetchDatabases();
    }, [projectId]);

    const fetchEnvVars = async () => {
        try {
            setLoading(true);
            const vars = await apiFetch(`/projects/${projectId}/env-vars`, {
                token: getToken()
            });
            // Filter out reserved system variables (they're managed automatically)
            const userVars = vars.filter(v => !RESERVED_KEYS.includes(v.key.toUpperCase()));
            setEnvVars(userVars.map(v => ({ key: v.key, value: v.value, id: v.id })));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const fetchDatabases = async () => {
        try {
            setDbLoading(true);
            const res = await apiFetch("/databases", { token: getToken() });
            setDatabases(res.databases || []);
        } catch {
            // Ignore: env editing still works without this convenience.
        } finally {
            setDbLoading(false);
        }
    };

    const attachManagedDatabase = async () => {
        if (!selectedDbId) return;
        setLinkingDb(true);
        setError("");
        setSuccessMessage("");
        try {
            const r = await apiFetch(`/databases/${selectedDbId}/link-project`, {
                method: "POST",
                token: getToken(),
                body: { projectId }
            });
            setSuccessMessage(r.message || "Database linked and env vars updated.");
            await fetchEnvVars();
        } catch (e) {
            setError(e.message);
        } finally {
            setLinkingDb(false);
        }
    };

    const handleRedeployClick = () => {
        if (onRedeploy) {
            onRedeploy();
            onClose(); // Close modal so user can see the card spinner
        }
    };

    const handleAddVar = () => {
        setEnvVars([...envVars, { key: "", value: "", id: `new-${Date.now()}` }]);
    };

    const handleRemoveVar = (id) => {
        setEnvVars(envVars.filter(v => v.id !== id));
    };

    const handleChangeKey = (id, newKey) => {
        setEnvVars(envVars.map(v => v.id === id ? { ...v, key: newKey } : v));
    };

    const handleChangeValue = (id, newValue) => {
        setEnvVars(envVars.map(v => v.id === id ? { ...v, value: newValue } : v));
    };

    const handleApply = async () => {
        // Validate
        const validVars = envVars.filter(v => v.key.trim() && v.value.trim());
        if (validVars.length === 0 && envVars.length > 0) {
            setError("Please fill in all key-value pairs or remove empty ones");
            return;
        }

        // Check for reserved keys
        const hasReservedKey = validVars.some(v =>
            RESERVED_KEYS.includes(v.key.trim().toUpperCase())
        );

        if (hasReservedKey) {
            const reservedFound = validVars.find(v => RESERVED_KEYS.includes(v.key.trim().toUpperCase()));
            setError(`"${reservedFound.key}" is a reserved system variable (PORT, NODE_ENV, HOST) and cannot be set manually.`);
            return;
        }

        setSaving(true);
        setError("");

        try {
            // Call hot-reload API endpoint
            const response = await apiFetch(`/projects/${projectId}/env-vars/hot-reload`, {
                method: "POST",
                token: getToken(),
                body: {
                    envVars: validVars.map(v => ({ key: v.key.trim(), value: v.value.trim() }))
                }
            });

            setSuccessMessage(response.message || "Environment variables updated successfully!");
            setTimeout(() => {
                onSuccess();
                onClose();
            }, 2000);
        } catch (e) {
            setError(e.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 2000
            }}
            onClick={onClose}
        >
            <div
                style={{
                    background: "white",
                    borderRadius: 12,
                    padding: 30,
                    maxWidth: 700,
                    width: "90%",
                    maxHeight: "80vh",
                    overflow: "auto",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.3)",
                    position: "relative"
                }}
                onClick={e => e.stopPropagation()}
            >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                    <h2 style={{ margin: 0 }}>Edit Environment Variables</h2>
                    <button
                        onClick={onClose}
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

                <div style={{ marginBottom: 20, padding: 12, background: "#f5f5f5", borderRadius: 6 }}>
                    <p style={{ margin: 0, fontSize: "0.9em", color: "#666" }}>
                        <strong>Project:</strong> {projectName}
                    </p>
                    <p style={{ margin: "5px 0 0 0", fontSize: "0.85em", color: "#888" }}>
                        For server deployments, changes will be applied immediately by restarting the container.
                        For static sites, you'll need to redeploy for changes to take effect.
                    </p>
                    <p style={{ margin: "5px 0 0 0", fontSize: "0.85em", color: "#888" }}>
                        <strong>Note:</strong> PORT, NODE_ENV, and HOST are managed automatically and cannot be edited here.
                    </p>
                </div>

                <div style={{
                    background: "#f9f9f9",
                    border: "1px solid #eee",
                    borderRadius: 10,
                    padding: 14,
                    marginBottom: 16
                }}>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>Managed Database</div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                        <select
                            value={selectedDbId}
                            onChange={(e) => setSelectedDbId(e.target.value)}
                            disabled={dbLoading || linkingDb}
                            style={{
                                flex: 1,
                                minWidth: 260,
                                padding: 10,
                                borderRadius: 6,
                                border: "1px solid #ddd"
                            }}
                        >
                            <option value="">{dbLoading ? "Loading databases..." : "Select a managed database..."}</option>
                            {databases.map((db) => (
                                <option key={db.id} value={db.id}>
                                    {db.name} ({db.type})
                                </option>
                            ))}
                        </select>
                        <button
                            onClick={attachManagedDatabase}
                            disabled={!selectedDbId || linkingDb}
                            style={{
                                background: linkingDb ? "#90caf9" : "#2196F3",
                                color: "white",
                                border: "none",
                                borderRadius: 6,
                                padding: "10px 14px",
                                cursor: !selectedDbId || linkingDb ? "not-allowed" : "pointer"
                            }}
                        >
                            {linkingDb ? "Attaching..." : "Attach & set URL"}
                        </button>
                        <button
                            onClick={handleRedeployClick}
                            disabled={!onRedeploy}
                            style={{
                                background: "#4caf50",
                                color: "white",
                                border: "none",
                                borderRadius: 6,
                                padding: "10px 14px",
                                cursor: onRedeploy ? "pointer" : "not-allowed",
                                opacity: onRedeploy ? 1 : 0.5
                            }}
                        >
                            Redeploy now
                        </button>
                    </div>
                    <div style={{ marginTop: 8, fontSize: "0.85em", color: "#666" }}>
                        This injects the correct URL into your project env vars (without revealing the DB password).
                    </div>
                </div>

                {error && (
                    <div style={{ marginBottom: 15, padding: 12, background: "#ffebee", color: "#c62828", borderRadius: 6, fontSize: "0.9em" }}>
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div style={{ marginBottom: 15, padding: 12, background: "#e8f5e9", color: "#2e7d32", borderRadius: 6, fontSize: "0.9em" }}>
                        ✓ {successMessage}
                    </div>
                )}

                {loading ? (
                    <div style={{ textAlign: "center", padding: 40, color: "#999" }}>Loading...</div>
                ) : (
                    <div>
                        <div style={{ marginBottom: 15 }}>
                            {envVars.length === 0 ? (
                                <div style={{ textAlign: "center", padding: 30, color: "#999", fontStyle: "italic" }}>
                                    No environment variables yet. Click "Add Variable" to create one.
                                </div>
                            ) : (
                                envVars.map(v => (
                                    <div key={v.id} style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                                        <input
                                            type="text"
                                            placeholder="KEY"
                                            value={v.key}
                                            onChange={e => handleChangeKey(v.id, e.target.value)}
                                            style={{
                                                flex: 1,
                                                padding: 10,
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                fontFamily: "monospace"
                                            }}
                                        />
                                        <input
                                            type="text"
                                            placeholder="value"
                                            value={v.value}
                                            onChange={e => handleChangeValue(v.id, e.target.value)}
                                            style={{
                                                flex: 2,
                                                padding: 10,
                                                border: "1px solid #ddd",
                                                borderRadius: 6,
                                                fontFamily: "monospace"
                                            }}
                                        />
                                        <button
                                            onClick={() => handleRemoveVar(v.id)}
                                            style={{
                                                background: "#ffebee",
                                                color: "#c62828",
                                                border: "1px solid #ef9a9a",
                                                borderRadius: 6,
                                                cursor: "pointer",
                                                padding: "0 15px"
                                            }}
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        <button
                            onClick={handleAddVar}
                            style={{
                                background: "#e3f2fd",
                                color: "#1565c0",
                                border: "1px solid #90caf9",
                                borderRadius: 6,
                                padding: "8px 16px",
                                cursor: "pointer",
                                fontSize: "0.9em",
                                marginBottom: 20
                            }}
                        >
                            + Add Variable
                        </button>

                        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", borderTop: "1px solid #eee", paddingTop: 20 }}>
                            <button
                                onClick={onClose}
                                disabled={saving}
                                style={{
                                    background: "#eee",
                                    color: "#333",
                                    border: "none",
                                    borderRadius: 6,
                                    padding: "10px 20px",
                                    cursor: saving ? "not-allowed" : "pointer",
                                    opacity: saving ? 0.6 : 1
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleApply}
                                disabled={saving}
                                style={{
                                    background: saving ? "#90caf9" : "#2196F3",
                                    color: "white",
                                    border: "none",
                                    borderRadius: 6,
                                    padding: "10px 20px",
                                    cursor: saving ? "not-allowed" : "pointer"
                                }}
                            >
                                {saving ? "Applying..." : "Apply Changes"}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
