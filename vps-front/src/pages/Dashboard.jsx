import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clearToken, getToken } from "../lib/auth";

export default function Dashboard() {
    const nav = useNavigate();
    const [user, setUser] = useState(null);
    const [err, setErr] = useState("");
    const [groups, setGroups] = useState([]);
    const [ungroupedProjects, setUngroupedProjects] = useState([]);
    const [showCreateGroup, setShowCreateGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");

    useEffect(() => {
        const token = getToken();
        if (!token) {
            nav("/login");
            return;
        }

        apiFetch("/me", { token })
            .then((d) => {
                setUser(d.user);
                fetchData();
            })
            .catch((e) => {
                setErr(e.message);
                clearToken();
                nav("/login");
            });
    }, [nav]);

    const fetchData = async () => {
        try {
            // Fetch groups and projects
            const [gRes, pRes] = await Promise.all([
                apiFetch("/groups", { token: getToken() }),
                apiFetch("/projects", { token: getToken() })
            ]);
            
            setGroups(gRes.groups || []);
            // Filter projects that are not in any group
            setUngroupedProjects((pRes.projects || []).filter(p => !p.groupId));
        } catch (e) { console.error(e); }
    };

    const createGroup = async () => {
        if (!newGroupName) return;
        try {
            await apiFetch("/groups", {
                method: "POST",
                token: getToken(),
                body: { name: newGroupName }
            });
            setNewGroupName("");
            setShowCreateGroup(false);
            fetchData();
        } catch (e) { alert(e.message); }
    };
    
    const deleteGroup = async (groupId, groupName) => {
        if (!window.confirm(`Delete project group "${groupName}"?\nThis will delete all contained sites and deployments.`)) return;
        try {
            await apiFetch(`/groups/${groupId}`, { method: "DELETE", token: getToken() });
            fetchData();
        } catch (e) { alert(e.message); }
    };

    function logout() {
        clearToken();
        nav("/login");
    }

    if (!user) return <div style={{ padding: 20 }}>Loading...</div>;

    const connectGithub = () => {
        const token = getToken();
        window.location.href = `/api/github/connect?token=${token}`;
    };

    const disconnectGithub = async () => {
        if (!confirm("Are you sure you want to disconnect your GitHub account? You won't be able to deploy new sites.")) return;
        try {
            await apiFetch("/github/disconnect", { method: "POST", token: getToken() });
            // Refresh user data
            const d = await apiFetch("/me", { token: getToken() });
            setUser(d.user);
        } catch (e) { alert(e.message); }
    };

    return (
        <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
                <h1>My Projects</h1>
                <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginRight: 10 }}>
                        <span style={{ fontSize: "0.9em", fontWeight: 500 }}>{user.email}</span>
                        {user.github ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8em", color: "#2e7d32" }}>
                                <svg height="14" viewBox="0 0 16 16" width="14" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
                                <span>Connected as <b>{user.github.username}</b></span>
                                <button onClick={disconnectGithub} style={{ background: "none", border: "none", color: "#c62828", textDecoration: "underline", cursor: "pointer", padding: 0, marginLeft: 5 }}>
                                    (Disconnect)
                                </button>
                            </div>
                        ) : (
                            <span style={{ fontSize: "0.8em", color: "#f57c00" }}>● GitHub Not Connected</span>
                        )}
                    </div>

                    <button onClick={() => setShowCreateGroup(true)} style={{ background: "#2196F3", color: "white", padding: "10px 20px", borderRadius: 6, border: "none", cursor: "pointer" }}>
                        + Create Project
                    </button>
                    <button onClick={logout} style={{ background: "#eee", color: "#333", border: "none", padding: "10px 20px", borderRadius: 6, cursor: "pointer" }}>Logout</button>
                </div>
            </div>
            
            {showCreateGroup && (
                <div style={{ marginBottom: 30, padding: 20, background: "#f5f5f5", borderRadius: 8 }}>
                    <h3>Create New Project</h3>
                    <div style={{ display: "flex", gap: 10 }}>
                        <input 
                            value={newGroupName} 
                            onChange={e => setNewGroupName(e.target.value)} 
                            placeholder="Project Name" 
                            style={{ flex: 1, padding: 10, borderRadius: 4, border: "1px solid #ddd" }}
                            autoFocus
                        />
                        <button onClick={createGroup} disabled={!newGroupName} style={{ background: "#2196F3", color: "white", padding: "0 20px", border: "none", borderRadius: 4, cursor: "pointer" }}>Create</button>
                        <button onClick={() => setShowCreateGroup(false)} style={{ background: "#eee", color: "#333", padding: "0 20px", border: "none", borderRadius: 4, cursor: "pointer" }}>Cancel</button>
                    </div>
                </div>
            )}

            {!user.github && (
                 <div style={{ textAlign: "center", padding: "20px", background: "#fff3cd", borderRadius: 8, marginBottom: 30 }}>
                    <p style={{ margin: "0 0 10px 0" }}>GitHub is not connected. You won\'t be able to deploy sites.</p>
                    <button onClick={connectGithub} style={{ background: "#333", color: "white", padding: "8px 16px", borderRadius: 4, border: "none", cursor: "pointer" }}>Connect GitHub</button>
                 </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
                {groups.map(g => (
                    <div 
                        key={g.id} 
                        onClick={() => nav(`/groups/${g.id}`)}
                        style={{ 
                            border: "1px solid #e0e0e0", borderRadius: 12, padding: 20, cursor: "pointer",
                            background: "white", transition: "box-shadow 0.2s ease",
                            boxShadow: "0 2px 5px rgba(0,0,0,0.05)"
                        }}
                        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 5px 15px rgba(0,0,0,0.1)"}
                        onMouseLeave={e => e.currentTarget.style.boxShadow = "0 2px 5px rgba(0,0,0,0.05)"}
                    >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                            <h3 style={{ margin: "0 0 10px 0", color: "#333" }}>{g.name}</h3>
                            <button 
                                onClick={(e) => { e.stopPropagation(); deleteGroup(g.id, g.name); }}
                                style={{ background: "none", border: "none", color: "#999", cursor: "pointer", padding: 5 }}
                            >✕</button>
                        </div>
                        <div style={{ color: "#666", fontSize: "0.9em" }}>
                            {g.projects.length} Site{g.projects.length !== 1 ? 's' : ''}
                        </div>
                        <div style={{ display: "flex", gap: 5, marginTop: 15 }}>
                            {g.projects.slice(0, 3).map(p => (
                                <div key={p.id} style={{ 
                                    width: 10, height: 10, borderRadius: "50%", 
                                    background: p.hasDeployedVersion ? "#4caf50" : "#bdbdbd" 
                                }} title={p.name} />
                            ))}
                        </div>
                    </div>
                ))}
            </div>
            
            {groups.length === 0 && ungroupedProjects.length === 0 && !showCreateGroup && (
                <div style={{ textAlign: "center", padding: 60, color: "#999" }}>
                    <h3>Welcome!</h3>
                    <p>Create a project to get started.</p>
                </div>
            )}
        </div>
    );
}