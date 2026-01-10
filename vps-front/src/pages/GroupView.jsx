import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";
import DeploymentWizard from "../components/DeploymentWizard";

export default function GroupView() {
    const { groupId } = useParams();
    const nav = useNavigate();
    const [group, setGroup] = useState(null);
    const [projects, setProjects] = useState([]);
    const [showWizard, setShowWizard] = useState(false);
    const [err, setErr] = useState("");

    useEffect(() => {
        if (!getToken()) {
            nav("/login");
            return;
        }
        fetchGroup();
    }, [groupId, nav]);

    const fetchGroup = async () => {
        try {
            // We need to fetch groups and find the one. 
            // Better to have GET /api/groups/:id, but we only implemented GET /api/groups
            // I'll filter for now, or implement GET /api/groups/:id later.
            // Let's rely on GET /api/groups for now to minimize backend changes if not strictly needed.
            const res = await apiFetch("/groups", { token: getToken() });
            const g = res.groups.find(g => g.id === groupId);
            if (!g) {
                setErr("Group not found");
                return;
            }
            setGroup(g);
            setProjects(g.projects || []);
        } catch (e) {
            setErr(e.message);
        }
    };
    
    // Deletion of Project
    const deleteProject = async (projectId, projectName) => {
        const confirmed = window.confirm(
            `Are you sure you want to delete "${projectName}"?\n\n` +
            `This will permanently delete:\n` +
            `• All deployments and logs\n` +
            `• All environment variables\n` +
            `• All deployed files and releases\n` +
            `• The cloned repository workspace\n\n` +
            `This action cannot be undone!`
        );

        if (!confirmed) return;

        try {
            await apiFetch(`/projects/${projectId}`, {
                method: "DELETE",
                token: getToken()
            });
            fetchGroup();
        } catch (e) {
            alert(`Failed to delete project: ${e.message}`);
        }
    };

    if (err) return <div style={{ padding: 40, textAlign: "center" }}>Error: {err}</div>;
    if (!group) return <div style={{ padding: 40 }}>Loading...</div>;

    return (
        <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
            <div style={{ marginBottom: 20 }}>
                <button onClick={() => nav("/dashboard")} style={{ background: "none", border: "none", cursor: "pointer", color: "#666" }}>
                    ← Back to Dashboard
                </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
                <div>
                    <h1 style={{ margin: 0 }}>{group.name}</h1>
                    <p style={{ color: "#666", marginTop: 5 }}>Project Group</p>
                </div>
                
                {!showWizard && (
                    <button onClick={() => setShowWizard(true)} style={{ background: "#2196F3", color: "white", padding: "10px 20px", borderRadius: 6, border: "none", cursor: "pointer" }}>
                        + Create New Site
                    </button>
                )}
            </div>

            {showWizard ? (
                <div>
                    <button onClick={() => setShowWizard(false)} style={{ marginBottom: 20 }}>Cancel</button>
                    <DeploymentWizard 
                        groupId={groupId}
                        onComplete={() => {
                            setShowWizard(false);
                            fetchGroup();
                        }} 
                    />
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
                    {projects.length === 0 ? (
                        <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, border: "2px dashed #ddd", borderRadius: 12 }}>
                            <h3>No sites yet</h3>
                            <p>Create your first site in this project group.</p>
                            <button onClick={() => setShowWizard(true)}>Create Site</button>
                        </div>
                    ) : (
                        projects.map(p => {
                            const latestStatus = p.latestDeployment?.status || "IDLE";
                            const isDeployed = p.hasDeployedVersion;
                            const domain = import.meta.env.VITE_BASE_DOMAIN || 'localhost';
                            const port = import.meta.env.VITE_PORT ? `:${import.meta.env.VITE_PORT}` : '';
                            const siteUrl = `http://${p.slug}.${domain}${port}`;

                            const statusColors = {
                                "DEPLOYED": { bg: "#e8f5e9", color: "#2e7d32" },
                                "BUILDING": { bg: "#e3f2fd", color: "#1565c0" },
                                "FINALIZING": { bg: "#fff3e0", color: "#ef6c00" },
                                "QUEUED": { bg: "#f3e5f5", color: "#7b1fa2" },
                                "FAILED": { bg: "#ffebee", color: "#c62828" },
                                "IDLE": { bg: "#f5f5f5", color: "#616161" }
                            };
                            const statusStyle = statusColors[latestStatus] || statusColors.IDLE;

                            return (
                                <div key={p.id} style={{ border: "1px solid #eee", padding: 20, borderRadius: 12, background: "white", boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                                    <h3 style={{ margin: "0 0 10px 0" }}>{p.name}</h3>
                                    <div style={{ fontSize: "0.9em", color: "#666", marginBottom: 15 }}>
                                        {isDeployed ? (
                                            <div>
                                                URL: <a href={siteUrl} target="_blank" rel="noreferrer" style={{ color: "#2196F3", textDecoration: "none", fontWeight: 500 }}>
                                                    {p.slug}.{domain}{port}
                                                </a>
                                            </div>
                                        ) : (
                                            <div style={{ color: "#999", fontStyle: "italic" }}>Not deployed yet</div>
                                        )}
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{
                                            padding: "4px 10px", borderRadius: 20, fontSize: "0.8em",
                                            background: statusStyle.bg, color: statusStyle.color
                                        }}>
                                            {latestStatus}
                                        </span>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button 
                                                onClick={() => deleteProject(p.id, p.name)}
                                                style={{
                                                    fontSize: "0.8em", padding: "4px 8px",
                                                    background: "#ffebee", color: "#c62828", border: "1px solid #ef9a9a", cursor: "pointer"
                                                }}
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
}
