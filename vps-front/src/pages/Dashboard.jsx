import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clearToken, getToken } from "../lib/auth";
import DeploymentWizard from "../components/DeploymentWizard";

export default function Dashboard() {
    const nav = useNavigate();
    const [user, setUser] = useState(null);
    const [err, setErr] = useState("");
    const [projects, setProjects] = useState([]);
    const [showWizard, setShowWizard] = useState(false);

    useEffect(() => {
        const token = getToken();
        if (!token) {
            nav("/login");
            return;
        }

        apiFetch("/me", { token })
            .then((d) => {
                setUser(d.user);
                fetchProjects();
            })
            .catch((e) => {
                setErr(e.message);
                clearToken();
                nav("/login");
            });
    }, [nav]);

    const fetchProjects = async () => {
        try {
            const data = await apiFetch("/github/repos", { token: getToken() });
            // Actually we need an endpoint for projects in our DB
            // For now, let's fetch them from /api/github/repos but we should have /api/projects
            // Let's assume /api/github/repos actually returns my DB projects for now or I'll add the endpoint.
            const res = await apiFetch("/projects", { token: getToken() });
            setProjects(res.projects || []);
        } catch (e) { console.error(e); }
    };

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
            // Refresh project list
            fetchProjects();
        } catch (e) {
            alert(`Failed to delete project: ${e.message}`);
        }
    };

    function logout() {
        clearToken();
        nav("/login");
    }

    if (!user) return <div style={{ padding: 20 }}>Loading...</div>;

    const connectGithub = () => {
        const token = getToken();
        // Use relative path so it goes through Nginx (works on localhost & VPS)
        window.location.href = `/api/github/connect?token=${token}`;
    };

    return (
        <div style={{ maxWidth: 1000, margin: "40px auto", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 30 }}>
                <h1>My Static Sites</h1>
                <div style={{ display: "flex", gap: 15, alignItems: "center" }}>
                    <span>{user.email}</span>
                    {!user.github ? (
                         <button onClick={connectGithub} style={{ background: "#333", color: "white", padding: "10px 20px", display: "flex", alignItems: "center", gap: 8 }}>
                            <svg height="20" viewBox="0 0 16 16" width="20" fill="white"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path></svg>
                            Connect GitHub
                         </button>
                    ) : (
                        <button onClick={() => setShowWizard(true)} style={{ background: "#2196F3", color: "white", padding: "10px 20px" }}>
                            + Create New Site
                        </button>
                    )}
                    <button onClick={logout} style={{ background: "#eee", color: "#333" }}>Logout</button>
                </div>
            </div>

            {!user.github ? (
                <div style={{ textAlign: "center", padding: "60px 20px", background: "#f9f9f9", borderRadius: 12, border: "1px dashed #ccc" }}>
                    <h2>GitHub Required</h2>
                    <p style={{ maxWidth: 500, margin: "0 auto 20px", color: "#666" }}>
                        To deploy your static sites, you need to connect your GitHub account. 
                        We need access to your repositories to clone and build your projects.
                    </p>
                    <button onClick={connectGithub} style={{ background: "#333", color: "white", padding: "12px 24px", fontSize: "1.1em", cursor: "pointer", border: "none", borderRadius: 6 }}>
                        Connect GitHub Account
                    </button>
                </div>
            ) : showWizard ? (
                <div>
                    <button onClick={() => setShowWizard(false)} style={{ marginBottom: 20 }}>← Cancel</button>
                    <DeploymentWizard 
                        onComplete={() => {
                            setShowWizard(false);
                            fetchProjects();
                        }} 
                    />
                </div>
            ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 20 }}>
                    {projects.length === 0 ? (
                        <div style={{ gridColumn: "1/-1", textAlign: "center", padding: 40, border: "2px dashed #ddd", borderRadius: 12 }}>
                            <h3>No sites yet</h3>
                            <p>Connect your GitHub and deploy your first static website.</p>
                            <button onClick={() => setShowWizard(true)}>Get Started</button>
                        </div>
                    ) : (
                        projects.map(p => {
                            const latestStatus = p.latestDeployment?.status || "IDLE";
                            const isDeployed = p.hasDeployedVersion;

                            // Status badge colors
                            const statusColors = {
                                "DEPLOYED": { bg: "#e8f5e9", color: "#2e7d32" },
                                "BUILDING": { bg: "#e3f2fd", color: "#1565c0" },
                                "FINALIZING": { bg: "#fff3e0", color: "#ef6c00" },
                                "QUEUED": { bg: "#f3e5f5", color: "#7b1fa2" },
                                "FAILED": { bg: "#ffebee", color: "#c62828" },
                                "IDLE": { bg: "#f5f5f5", color: "#616161" }
                            };

                            const statusStyle = statusColors[latestStatus] || statusColors.IDLE;

                            // Build site URL
                            const domain = import.meta.env.VITE_BASE_DOMAIN || 'localhost';
                            const port = import.meta.env.VITE_PORT ? `:${import.meta.env.VITE_PORT}` : '';
                            const siteUrl = `http://${p.slug}.${domain}${port}`;

                            return (
                                <div key={p.id} style={{ border: "1px solid #eee", padding: 20, borderRadius: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                                    <h3 style={{ margin: "0 0 10px 0" }}>{p.name}</h3>
                                    <div style={{ fontSize: "0.9em", color: "#666", marginBottom: 15 }}>
                                        {isDeployed ? (
                                            <div>
                                                URL: <a href={siteUrl} target="_blank" rel="noreferrer" style={{ color: "#2196F3", textDecoration: "none", fontWeight: 500 }}>
                                                    {p.slug}.{domain}{port}
                                                </a>
                                            </div>
                                        ) : (
                                            <div style={{ color: "#999", fontStyle: "italic" }}>
                                                Not deployed yet
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <span style={{
                                            padding: "4px 10px", borderRadius: 20, fontSize: "0.8em",
                                            background: statusStyle.bg,
                                            color: statusStyle.color
                                        }}>
                                            {latestStatus}
                                        </span>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button onClick={() => {}} style={{ fontSize: "0.8em", padding: "4px 8px" }}>View Logs</button>
                                            <button
                                                onClick={() => deleteProject(p.id, p.name)}
                                                style={{
                                                    fontSize: "0.8em",
                                                    padding: "4px 8px",
                                                    background: "#ffebee",
                                                    color: "#c62828",
                                                    border: "1px solid #ef9a9a",
                                                    cursor: "pointer"
                                                }}
                                                title="Delete project and all files"
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

