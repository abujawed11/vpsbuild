import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clearToken, getToken } from "../lib/auth";

export default function DatabaseManagement() {
    const { id } = useParams();
    const nav = useNavigate();
    const [database, setDatabase] = useState(null);
    const [stats, setStats] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState("overview");
    const [actionLoading, setActionLoading] = useState(false);

    // Query Editor state
    const [query, setQuery] = useState("");
    const [queryResult, setQueryResult] = useState(null);
    const [queryLoading, setQueryLoading] = useState(false);
    const [queryError, setQueryError] = useState("");

    // Tables state
    const [tables, setTables] = useState([]);
    const [tablesLoading, setTablesLoading] = useState(false);
    const [selectedTable, setSelectedTable] = useState(null);
    const [tableData, setTableData] = useState(null);

    // Projects for linking
    const [projects, setProjects] = useState([]);
    const [selectedProjectId, setSelectedProjectId] = useState("");

    useEffect(() => {
        const token = getToken();
        if (!token) {
            nav("/login");
            return;
        }
        fetchDatabase();
        fetchProjects();
    }, [id, nav]);

    const fetchDatabase = async () => {
        try {
            const [dbRes, statsRes] = await Promise.all([
                apiFetch(`/databases/${id}`, { token: getToken() }),
                apiFetch(`/databases/${id}/stats`, { token: getToken() }).catch(() => null)
            ]);
            setDatabase(dbRes);
            setStats(statsRes);
        } catch (e) {
            console.error(e);
            nav("/databases");
        } finally {
            setLoading(false);
        }
    };

    const fetchProjects = async () => {
        try {
            const res = await apiFetch("/projects", { token: getToken() });
            const available = (res.projects || []).filter(p => !p.databaseId);
            setProjects(available);
        } catch (e) {
            console.error(e);
        }
    };

    const fetchTables = async () => {
        setTablesLoading(true);
        try {
            const res = await apiFetch(`/databases/${id}/tables`, { token: getToken() });
            setTables(res.tables || []);
        } catch (e) {
            console.error(e);
        } finally {
            setTablesLoading(false);
        }
    };

    const fetchTableData = async (tableName) => {
        try {
            // Fetch both schema and rows
            const [schemaRes, rowsRes] = await Promise.all([
                apiFetch(`/databases/${id}/tables/${tableName}`, { token: getToken() }),
                apiFetch(`/databases/${id}/tables/${tableName}/rows?limit=50`, { token: getToken() })
            ]);
            setTableData({
                name: tableName,
                columns: schemaRes.columns,
                ...rowsRes
            });
        } catch (e) {
            console.error(e);
        }
    };

    const handleAction = async (action) => {
        setActionLoading(true);
        try {
            await apiFetch(`/databases/${id}/${action}`, {
                method: "POST",
                token: getToken()
            });
            await fetchDatabase();
        } catch (e) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm(`Are you sure you want to delete "${database.name}"? This will permanently delete all data.`)) {
            return;
        }
        setActionLoading(true);
        try {
            await apiFetch(`/databases/${id}`, {
                method: "DELETE",
                token: getToken()
            });
            nav("/databases");
        } catch (e) {
            alert(e.message);
            setActionLoading(false);
        }
    };

    const handleResetPassword = async () => {
        if (!window.confirm("This will generate a new password. Make sure to save it!")) {
            return;
        }
        setActionLoading(true);
        try {
            const res = await apiFetch(`/databases/${id}/reset-password`, {
                method: "POST",
                token: getToken()
            });
            alert(`New password: ${res.password}\n\nNew connection URL:\n${res.connectionUrl}`);
            await fetchDatabase();
        } catch (e) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleLinkProject = async () => {
        if (!selectedProjectId) return;
        setActionLoading(true);
        try {
            await apiFetch(`/databases/${id}/link-project`, {
                method: "POST",
                token: getToken(),
                body: { projectId: selectedProjectId }
            });
            setSelectedProjectId("");
            await fetchDatabase();
            await fetchProjects();
        } catch (e) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleUnlinkProject = async () => {
        if (!window.confirm("Unlink database from project? This will remove DATABASE_URL from the project's environment.")) {
            return;
        }
        setActionLoading(true);
        try {
            await apiFetch(`/databases/${id}/unlink-project`, {
                method: "POST",
                token: getToken()
            });
            await fetchDatabase();
            await fetchProjects();
        } catch (e) {
            alert(e.message);
        } finally {
            setActionLoading(false);
        }
    };

    const executeQuery = async () => {
        if (!query.trim()) return;
        setQueryLoading(true);
        setQueryError("");
        setQueryResult(null);
        try {
            const res = await apiFetch(`/databases/${id}/query`, {
                method: "POST",
                token: getToken(),
                body: { query: query.trim() }
            });
            if (res.success) {
                setQueryResult(res);
            } else {
                setQueryError(res.error);
            }
        } catch (e) {
            setQueryError(e.message);
        } finally {
            setQueryLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    const getStatusColor = (status) => {
        switch (status) {
            case 'RUNNING': return '#4caf50';
            case 'STOPPED': return '#ff9800';
            case 'CREATING': return '#2196F3';
            case 'FAILED': return '#f44336';
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

    const formatUptime = (seconds) => {
        if (!seconds) return 'N/A';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${mins}m`;
        return `${mins}m`;
    };

    if (loading) {
        return <div style={{ padding: 40, textAlign: "center" }}>Loading...</div>;
    }

    if (!database) {
        return <div style={{ padding: 40, textAlign: "center" }}>Database not found</div>;
    }

    const tabs = [
        { id: "overview", label: "Overview" },
        { id: "query", label: "Query Editor" },
        { id: "tables", label: "Tables" },
        { id: "settings", label: "Settings" }
    ];

    return (
        <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
            {/* Header */}
            <div style={{ marginBottom: 24 }}>
                <button
                    onClick={() => nav("/databases")}
                    style={{ background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: "0.9em", marginBottom: 10 }}
                >
                    ← Back to Databases
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ fontSize: "2em" }}>{getDbTypeIcon(database.type)}</span>
                    <div>
                        <h1 style={{ margin: 0 }}>{database.name}</h1>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
                            <span style={{ color: "#666" }}>{database.type} {database.version}</span>
                            <span style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "4px 10px",
                                borderRadius: 12,
                                background: `${getStatusColor(database.status)}15`,
                                color: getStatusColor(database.status),
                                fontSize: "0.85em",
                                fontWeight: 600
                            }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: getStatusColor(database.status) }}></span>
                                {database.status}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ borderBottom: "1px solid #e0e0e0", marginBottom: 24 }}>
                <div style={{ display: "flex", gap: 0 }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id);
                                if (tab.id === "tables") fetchTables();
                            }}
                            style={{
                                background: "none",
                                border: "none",
                                padding: "12px 20px",
                                cursor: "pointer",
                                borderBottom: activeTab === tab.id ? "2px solid #2196F3" : "2px solid transparent",
                                color: activeTab === tab.id ? "#2196F3" : "#666",
                                fontWeight: activeTab === tab.id ? 600 : 400
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Tab Content */}
            {activeTab === "overview" && (
                <div>
                    {/* Connection Details */}
                    <div style={{ background: "#f9f9f9", borderRadius: 8, padding: 20, marginBottom: 20 }}>
                        <h3 style={{ margin: "0 0 16px 0" }}>Connection Details</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                            {[
                                { label: "Host", value: database.host },
                                { label: "Port", value: database.port },
                                { label: "Database", value: database.dbName },
                                { label: "Username", value: database.username }
                            ].map(item => (
                                <div key={item.label}>
                                    <label style={{ display: "block", fontSize: "0.8em", color: "#666", marginBottom: 4 }}>{item.label}</label>
                                    <div style={{ display: "flex", gap: 8 }}>
                                        <input readOnly value={item.value} style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontFamily: "monospace", fontSize: "0.9em" }} />
                                        <button onClick={() => copyToClipboard(String(item.value))} style={{ background: "#f0f0f0", border: "none", borderRadius: 4, padding: "0 10px", cursor: "pointer" }}>📋</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ marginTop: 12 }}>
                            <label style={{ display: "block", fontSize: "0.8em", color: "#666", marginBottom: 4 }}>Connection URL (password hidden)</label>
                            <div style={{ display: "flex", gap: 8 }}>
                                <input readOnly value={database.connectionUrl} style={{ flex: 1, padding: 8, borderRadius: 4, border: "1px solid #ddd", fontFamily: "monospace", fontSize: "0.85em" }} />
                                <button onClick={() => copyToClipboard(database.connectionUrl)} style={{ background: "#f0f0f0", border: "none", borderRadius: 4, padding: "0 10px", cursor: "pointer" }}>📋</button>
                            </div>
                        </div>
                        <p style={{ fontSize: "0.8em", color: "#888", margin: "12px 0 0 0" }}>
                            ⚠️ Password is hidden for security. Use "Reset Password" to get a new one.
                        </p>
                    </div>

                    {/* Statistics */}
                    {stats && (
                        <div style={{ background: "#f9f9f9", borderRadius: 8, padding: 20, marginBottom: 20 }}>
                            <h3 style={{ margin: "0 0 16px 0" }}>Statistics</h3>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: "1.5em", fontWeight: 600 }}>{stats.diskUsageMB || 0} MB</div>
                                    <div style={{ fontSize: "0.85em", color: "#666" }}>Disk Usage</div>
                                </div>
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: "1.5em", fontWeight: 600 }}>{stats.tableCount || 0}</div>
                                    <div style={{ fontSize: "0.85em", color: "#666" }}>Tables</div>
                                </div>
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: "1.5em", fontWeight: 600 }}>{formatUptime(stats.uptime)}</div>
                                    <div style={{ fontSize: "0.85em", color: "#666" }}>Uptime</div>
                                </div>
                                <div style={{ textAlign: "center" }}>
                                    <div style={{ fontSize: "1.5em", fontWeight: 600 }}>{stats.connections || 0}</div>
                                    <div style={{ fontSize: "0.85em", color: "#666" }}>Connections</div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Linked Project */}
                    <div style={{ background: "#f9f9f9", borderRadius: 8, padding: 20 }}>
                        <h3 style={{ margin: "0 0 16px 0" }}>Linked Project</h3>
                        {database.project ? (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "white", padding: 12, borderRadius: 6, border: "1px solid #e0e0e0" }}>
                                <div>
                                    <div style={{ fontWeight: 500 }}>🔗 {database.project.name}</div>
                                    <div style={{ fontSize: "0.85em", color: "#666" }}>DATABASE_URL added to environment</div>
                                </div>
                                <button onClick={handleUnlinkProject} disabled={actionLoading} style={{ background: "#ff9800", color: "white", border: "none", borderRadius: 4, padding: "8px 16px", cursor: "pointer" }}>
                                    Unlink
                                </button>
                            </div>
                        ) : (
                            <div>
                                <p style={{ color: "#666", margin: "0 0 12px 0" }}>Not linked to any project.</p>
                                <div style={{ display: "flex", gap: 8 }}>
                                    <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ddd" }}>
                                        <option value="">Select a project...</option>
                                        {projects.map(p => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                    <button onClick={handleLinkProject} disabled={!selectedProjectId || actionLoading} style={{ background: "#2196F3", color: "white", border: "none", borderRadius: 6, padding: "0 20px", cursor: "pointer" }}>
                                        Link
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === "query" && (
                <div>
                    <div style={{ marginBottom: 16 }}>
                        <textarea
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={`Enter your ${database.type === 'MYSQL' ? 'MySQL' : 'PostgreSQL'} query here...\n\nExample: SELECT * FROM users LIMIT 10;`}
                            style={{
                                width: "100%",
                                height: 150,
                                padding: 12,
                                borderRadius: 6,
                                border: "1px solid #ddd",
                                fontFamily: "monospace",
                                fontSize: "0.9em",
                                resize: "vertical",
                                boxSizing: "border-box"
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                    executeQuery();
                                }
                            }}
                        />
                    </div>
                    <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                        <button onClick={executeQuery} disabled={queryLoading || !query.trim()} style={{ background: "#2196F3", color: "white", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
                            {queryLoading ? "Running..." : "Run Query"} (Ctrl+Enter)
                        </button>
                        <button onClick={() => { setQuery(""); setQueryResult(null); setQueryError(""); }} style={{ background: "#f0f0f0", color: "#333", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
                            Clear
                        </button>
                    </div>

                    {queryError && (
                        <div style={{ background: "#ffebee", color: "#c62828", padding: 16, borderRadius: 6, marginBottom: 16, fontFamily: "monospace", fontSize: "0.9em" }}>
                            {queryError}
                        </div>
                    )}

                    {queryResult && (
                        <div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                                <span style={{ color: "#4caf50", fontWeight: 500 }}>
                                    ✓ Query executed in {queryResult.executionTime}ms ({queryResult.rowCount} rows)
                                </span>
                            </div>
                            {queryResult.fields && queryResult.fields.length > 0 && (
                                <div style={{ overflowX: "auto", border: "1px solid #e0e0e0", borderRadius: 6 }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85em" }}>
                                        <thead>
                                            <tr style={{ background: "#f5f5f5" }}>
                                                {queryResult.fields.map((f, i) => (
                                                    <th key={i} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e0e0e0" }}>
                                                        {f.name}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {queryResult.results.length > 0 ? (
                                                queryResult.results.map((row, i) => (
                                                    <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                                                        {queryResult.fields.map((f, j) => (
                                                            <td key={j} style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                                                                {row[f.name] === null ? <span style={{ color: "#999" }}>NULL</span> : String(row[f.name])}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))
                                            ) : (
                                                <tr>
                                                    <td colSpan={queryResult.fields.length} style={{ padding: "20px", textAlign: "center", color: "#999" }}>
                                                        No rows returned
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {activeTab === "tables" && (
                <div>
                    {tablesLoading ? (
                        <div style={{ textAlign: "center", padding: 40, color: "#666" }}>Loading tables...</div>
                    ) : tables.length === 0 ? (
                        <div style={{ textAlign: "center", padding: 40, color: "#666", background: "#f9f9f9", borderRadius: 8 }}>
                            <div style={{ fontSize: "2em", marginBottom: 10 }}>📋</div>
                            <p>No tables found in this database.</p>
                            <p style={{ fontSize: "0.9em" }}>Use the Query Editor to create tables.</p>
                        </div>
                    ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
                            {tables.map(table => (
                                <div
                                    key={table.name}
                                    onClick={() => { setSelectedTable(table.name); fetchTableData(table.name); }}
                                    style={{
                                        padding: 16,
                                        background: "white",
                                        border: "1px solid #e0e0e0",
                                        borderRadius: 8,
                                        cursor: "pointer",
                                        transition: "box-shadow 0.2s"
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)"}
                                    onMouseLeave={e => e.currentTarget.style.boxShadow = "none"}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <span>📋</span>
                                        <span style={{ fontWeight: 500 }}>{table.name}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {selectedTable && tableData && (
                        <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
                            <div style={{ background: "white", borderRadius: 12, padding: 24, width: "90%", maxWidth: 900, maxHeight: "80vh", overflow: "auto" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                                    <h2 style={{ margin: 0 }}>📋 {selectedTable}</h2>
                                    <button onClick={() => { setSelectedTable(null); setTableData(null); }} style={{ background: "none", border: "none", fontSize: "1.5em", cursor: "pointer", color: "#999" }}>×</button>
                                </div>
                                {tableData.columns && tableData.columns.length > 0 ? (
                                    <div style={{ overflowX: "auto" }}>
                                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85em" }}>
                                            <thead>
                                                <tr style={{ background: "#f5f5f5" }}>
                                                    {tableData.columns.map(col => (
                                                        <th key={col.name} style={{ padding: "10px 12px", textAlign: "left", borderBottom: "1px solid #e0e0e0" }}>
                                                            <div>{col.name}</div>
                                                            <div style={{ fontSize: "0.75em", color: "#888", fontWeight: "normal" }}>{col.type}</div>
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {tableData.rows && tableData.rows.length > 0 ? (
                                                    tableData.rows.map((row, i) => (
                                                        <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                                                            {tableData.columns.map((col, j) => (
                                                                <td key={j} style={{ padding: "8px 12px", fontFamily: "monospace" }}>
                                                                    {row[col.name] === null ? <span style={{ color: "#999" }}>NULL</span> : String(row[col.name])}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))
                                                ) : (
                                                    <tr>
                                                        <td colSpan={tableData.columns.length} style={{ padding: "20px", textAlign: "center", color: "#999" }}>
                                                            No rows in this table
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p style={{ color: "#666" }}>Could not fetch table structure.</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === "settings" && (
                <div>
                    {/* Status Controls */}
                    <div style={{ background: "#f9f9f9", borderRadius: 8, padding: 20, marginBottom: 20 }}>
                        <h3 style={{ margin: "0 0 16px 0" }}>Status Controls</h3>
                        <div style={{ display: "flex", gap: 10 }}>
                            {database.status === 'RUNNING' && (
                                <>
                                    <button onClick={() => handleAction('stop')} disabled={actionLoading} style={{ background: "#ff9800", color: "white", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
                                        Stop Database
                                    </button>
                                    <button onClick={() => handleAction('restart')} disabled={actionLoading} style={{ background: "#2196F3", color: "white", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
                                        Restart Database
                                    </button>
                                </>
                            )}
                            {database.status === 'STOPPED' && (
                                <button onClick={() => handleAction('start')} disabled={actionLoading} style={{ background: "#4caf50", color: "white", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
                                    Start Database
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Security */}
                    <div style={{ background: "#f9f9f9", borderRadius: 8, padding: 20, marginBottom: 20 }}>
                        <h3 style={{ margin: "0 0 16px 0" }}>Security</h3>
                        <button onClick={handleResetPassword} disabled={actionLoading} style={{ background: "#2196F3", color: "white", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
                            🔄 Reset Password
                        </button>
                        <p style={{ fontSize: "0.85em", color: "#666", margin: "10px 0 0 0" }}>
                            Generate a new password for this database. The new password will be displayed once.
                        </p>
                    </div>

                    {/* Danger Zone */}
                    <div style={{ background: "#fff5f5", borderRadius: 8, padding: 20, border: "1px solid #ffcdd2" }}>
                        <h3 style={{ margin: "0 0 16px 0", color: "#c62828" }}>Danger Zone</h3>
                        <button onClick={handleDelete} disabled={actionLoading} style={{ background: "#f44336", color: "white", border: "none", borderRadius: 6, padding: "10px 20px", cursor: "pointer" }}>
                            🗑️ Delete Database
                        </button>
                        <p style={{ fontSize: "0.85em", color: "#c62828", margin: "10px 0 0 0" }}>
                            This action cannot be undone. All data will be permanently deleted.
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}
