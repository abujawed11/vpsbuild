import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";
import DeploymentWizard from "../components/DeploymentWizard";
import EditEnvModal from "../components/EditEnvModal";

export default function GroupView() {
    const { groupId } = useParams();
    const nav = useNavigate();
    const [group, setGroup] = useState(null);
    const [projects, setProjects] = useState([]);
    const [showWizard, setShowWizard] = useState(false);
    const [err, setErr] = useState("");
    const [deletingProjectId, setDeletingProjectId] = useState(null);
    const [openMenuId, setOpenMenuId] = useState(null);
    const [editingEnvProjectId, setEditingEnvProjectId] = useState(null);

    const baseDomain = import.meta.env.VITE_BASE_DOMAIN || "localhost";
    const basePort = import.meta.env.VITE_PORT ? `:${import.meta.env.VITE_PORT}` : "";
    const baseUrl = `http://${baseDomain}${basePort}`;

    useEffect(() => {
        if (!getToken()) {
            nav("/login");
            return;
        }
        fetchGroup();
    }, [groupId, nav]);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setOpenMenuId(null);
        if (openMenuId) {
            document.addEventListener("click", handleClickOutside);
            return () => document.removeEventListener("click", handleClickOutside);
        }
    }, [openMenuId]);

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
            `Delete "${projectName}"?\n\n` +
            `This will permanently remove your site and all its data.\n` +
            `This action cannot be undone.`
        );

        if (!confirmed) return;

        setDeletingProjectId(projectId);

        try {
            await apiFetch(`/projects/${projectId}`, {
                method: "DELETE",
                token: getToken()
            });
            fetchGroup();
        } catch (e) {
            alert(`Failed to delete project: ${e.message}`);
        } finally {
            setDeletingProjectId(null);
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
                            // Both server and frontend now use subdomain-based routing
                            const siteUrl = `http://${p.slug}.${baseDomain}${basePort}`;
                            const siteLabel = `${p.slug}.${baseDomain}${basePort}`;

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
                                                    {siteLabel}
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
                                        <div style={{ position: "relative" }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setOpenMenuId(openMenuId === p.id ? null : p.id);
                                                }}
                                                style={{
                                                    background: "none",
                                                    border: "1px solid #ddd",
                                                    borderRadius: 4,
                                                    cursor: "pointer",
                                                    padding: "4px 8px",
                                                    fontSize: "1.2em",
                                                    color: "#666",
                                                    lineHeight: 1
                                                }}
                                            >
                                                ⋮
                                            </button>
                                            {openMenuId === p.id && (
                                                <div style={{
                                                    position: "absolute",
                                                    right: 0,
                                                    top: "100%",
                                                    marginTop: 4,
                                                    background: "white",
                                                    border: "1px solid #ddd",
                                                    borderRadius: 6,
                                                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                                                    minWidth: 180,
                                                    zIndex: 1000
                                                }}>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId(null);
                                                            setEditingEnvProjectId(p.id);
                                                        }}
                                                        style={{
                                                            width: "100%",
                                                            textAlign: "left",
                                                            padding: "10px 15px",
                                                            background: "none",
                                                            border: "none",
                                                            cursor: "pointer",
                                                            fontSize: "0.9em",
                                                            borderBottom: "1px solid #eee"
                                                        }}
                                                        onMouseEnter={e => e.target.style.background = "#f5f5f5"}
                                                        onMouseLeave={e => e.target.style.background = "none"}
                                                    >
                                                        Edit Environment Variables
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setOpenMenuId(null);
                                                            deleteProject(p.id, p.name);
                                                        }}
                                                        disabled={deletingProjectId === p.id}
                                                        style={{
                                                            width: "100%",
                                                            textAlign: "left",
                                                            padding: "10px 15px",
                                                            background: "none",
                                                            border: "none",
                                                            cursor: deletingProjectId === p.id ? "not-allowed" : "pointer",
                                                            fontSize: "0.9em",
                                                            color: deletingProjectId === p.id ? "#999" : "#c62828",
                                                            opacity: deletingProjectId === p.id ? 0.7 : 1
                                                        }}
                                                        onMouseEnter={e => !deletingProjectId && (e.target.style.background = "#ffebee")}
                                                        onMouseLeave={e => e.target.style.background = "none"}
                                                    >
                                                        {deletingProjectId === p.id ? "Deleting..." : "Delete"}
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}

            {editingEnvProjectId && (
                <EditEnvModal
                    projectId={editingEnvProjectId}
                    projectName={projects.find(p => p.id === editingEnvProjectId)?.name || ""}
                    onClose={() => setEditingEnvProjectId(null)}
                    onSuccess={() => {
                        fetchGroup();
                    }}
                />
            )}
        </div>
    );
}
