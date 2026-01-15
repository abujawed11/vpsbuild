import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clearToken, getToken } from "../lib/auth";
import CreateDatabaseModal from "../components/CreateDatabaseModal";

export default function Databases() {
    const nav = useNavigate();
    const [user, setUser] = useState(null);
    const [databases, setDatabases] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [actionLoading, setActionLoading] = useState(null);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            nav("/login");
            return;
        }

        apiFetch("/me", { token })
            .then((d) => {
                setUser(d.user);
                fetchDatabases();
            })
            .catch((e) => {
                clearToken();
                nav("/login");
            });
    }, [nav]);

    const fetchDatabases = async () => {
        try {
            const res = await apiFetch("/databases", { token: getToken() });
            setDatabases(res.databases || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async (dbId, action) => {
        setActionLoading(`${dbId}-${action}`);
        try {
            await apiFetch(`/databases/${dbId}/${action}`, {
                method: "POST",
                token: getToken()
            });
            await fetchDatabases();
        } catch (e) {
            alert(e.message);
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (db) => {
        if (!window.confirm(`Are you sure you want to delete "${db.name}"? This action cannot be undone and all data will be lost.`)) {
            return;
        }
        setActionLoading(`${db.id}-delete`);
        try {
            await apiFetch(`/databases/${db.id}`, {
                method: "DELETE",
                token: getToken()
            });
            await fetchDatabases();
        } catch (e) {
            alert(e.message);
        } finally {
            setActionLoading(null);
        }
    };

    const logout = () => {
        clearToken();
        nav("/login");
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'RUNNING': return '#4caf50';
            case 'STOPPED': return '#ff9800';
            case 'CREATING': return '#2196F3';
            case 'FAILED': return '#f44336';
            case 'DELETING': return '#9e9e9e';
            default: return '#9e9e9e';
        }
    };

    const getDbTypeIcon = (type) => {
        switch (type) {
            case 'MYSQL': return '🐬';
            case 'POSTGRES': return '🐘';
            case 'MONGODB': return '🍃';
            default: return '🗄️';
        }
    };

    if (!user) return <div style={{ padding: 20 }}>Loading...</div>;

    return (
        <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <button
                        onClick={() => nav("/dashboard")}
                        style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "0.9em" }}
                    >
                        ← Back to Projects
                    </button>
                    <h1 style={{ margin: 0 }}>Databases</h1>
                </div>
                <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
                    <span style={{ fontSize: "0.9em", color: "#666" }}>{user.email}</span>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        style={{ background: "#2196F3", color: "white", padding: "10px 20px", borderRadius: 6, border: "none", cursor: "pointer" }}
                    >
                        + Create Database
                    </button>
                    <button onClick={logout} style={{ background: "#eee", color: "#333", border: "none", padding: "10px 20px", borderRadius: 6, cursor: "pointer" }}>
                        Logout
                    </button>
                </div>
            </div>

            {loading ? (
                <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
                    Loading databases...
                </div>
            ) : databases.length === 0 ? (
                <div style={{ textAlign: "center", padding: 60, color: "#999", background: "#f9f9f9", borderRadius: 12 }}>
                    <div style={{ fontSize: "3em", marginBottom: 20 }}>🗄️</div>
                    <h3>No databases yet</h3>
                    <p>Create your first managed database to get started.</p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        style={{ background: "#2196F3", color: "white", padding: "12px 24px", borderRadius: 6, border: "none", cursor: "pointer", marginTop: 10 }}
                    >
                        + Create Database
                    </button>
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
                    {databases.map(db => (
                        <div
                            key={db.id}
                            style={{
                                border: "1px solid #e0e0e0",
                                borderRadius: 12,
                                padding: 20,
                                background: "white",
                                boxShadow: "0 2px 5px rgba(0,0,0,0.05)",
                                position: "relative"
                            }}
                        >
                            {actionLoading?.startsWith(db.id) && (
                                <div style={{
                                    position: "absolute",
                                    top: 0, left: 0, right: 0, bottom: 0,
                                    background: "rgba(255, 255, 255, 0.9)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    borderRadius: 12,
                                    zIndex: 10
                                }}>
                                    <div className="spinner"></div>
                                </div>
                            )}

                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                                <div>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span style={{ fontSize: "1.5em" }}>{getDbTypeIcon(db.type)}</span>
                                        <h3 style={{ margin: 0, color: "#333" }}>{db.name}</h3>
                                    </div>
                                    <div style={{ fontSize: "0.85em", color: "#666", marginTop: 4 }}>
                                        {db.type} {db.version}
                                    </div>
                                </div>
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "4px 10px",
                                    borderRadius: 12,
                                    background: `${getStatusColor(db.status)}15`,
                                    color: getStatusColor(db.status),
                                    fontSize: "0.8em",
                                    fontWeight: 600
                                }}>
                                    <span style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: "50%",
                                        background: getStatusColor(db.status)
                                    }}></span>
                                    {db.status}
                                </div>
                            </div>

                            <div style={{ fontSize: "0.85em", color: "#888", marginBottom: 8 }}>
                                {db.diskUsageMB > 0 ? `${db.diskUsageMB} MB` : '< 1 MB'} used
                            </div>

                            {db.project && (
                                <div style={{
                                    fontSize: "0.85em",
                                    color: "#2196F3",
                                    marginBottom: 12,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4
                                }}>
                                    🔗 Linked to: {db.project.name}
                                </div>
                            )}

                            <div style={{
                                background: "#f8f8f8",
                                padding: 10,
                                borderRadius: 6,
                                marginBottom: 12,
                                fontSize: "0.8em",
                                fontFamily: "monospace",
                                color: "#555",
                                wordBreak: "break-all"
                            }}>
                                {db.connectionUrl}
                            </div>

                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                                <button
                                    onClick={() => nav(`/databases/${db.id}`)}
                                    style={{
                                        flex: 1,
                                        background: "#2196F3",
                                        color: "white",
                                        padding: "8px 12px",
                                        borderRadius: 6,
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "0.85em"
                                    }}
                                >
                                    Manage
                                </button>

                                {db.status === 'RUNNING' && (
                                    <button
                                        onClick={() => handleAction(db.id, 'stop')}
                                        style={{
                                            background: "#ff9800",
                                            color: "white",
                                            padding: "8px 12px",
                                            borderRadius: 6,
                                            border: "none",
                                            cursor: "pointer",
                                            fontSize: "0.85em"
                                        }}
                                    >
                                        Stop
                                    </button>
                                )}

                                {db.status === 'STOPPED' && (
                                    <button
                                        onClick={() => handleAction(db.id, 'start')}
                                        style={{
                                            background: "#4caf50",
                                            color: "white",
                                            padding: "8px 12px",
                                            borderRadius: 6,
                                            border: "none",
                                            cursor: "pointer",
                                            fontSize: "0.85em"
                                        }}
                                    >
                                        Start
                                    </button>
                                )}

                                <button
                                    onClick={() => handleDelete(db)}
                                    style={{
                                        background: "#f44336",
                                        color: "white",
                                        padding: "8px 12px",
                                        borderRadius: 6,
                                        border: "none",
                                        cursor: "pointer",
                                        fontSize: "0.85em"
                                    }}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showCreateModal && (
                <CreateDatabaseModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={(newDb) => {
                        setShowCreateModal(false);
                        fetchDatabases();
                    }}
                />
            )}
        </div>
    );
}
