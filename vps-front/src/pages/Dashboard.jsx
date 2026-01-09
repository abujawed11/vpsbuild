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

        apiFetch("/api/me", { token })
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
            const data = await apiFetch("/api/github/repos", { token: getToken() });
            // Actually we need an endpoint for projects in our DB
            // For now, let's fetch them from /api/github/repos but we should have /api/projects
            // Let's assume /api/github/repos actually returns my DB projects for now or I'll add the endpoint.
            const res = await apiFetch("/api/projects", { token: getToken() });
            setProjects(res.projects || []);
        } catch (e) { console.error(e); }
    };

    function logout() {
        clearToken();
        nav("/login");
    }

    if (!user) return <div style={{ padding: 20 }}>Loading...</div>;

    const connectGithub = () => {
        const token = getToken();
        // Redirect to backend auth endpoint
        window.location.href = `http://localhost:5000/api/github/connect?token=${token}`;
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
                        projects.map(p => (
                            <div key={p.id} style={{ border: "1px solid #eee", padding: 20, borderRadius: 12, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                                <h3 style={{ margin: "0 0 10px 0" }}>{p.name}</h3>
                                <div style={{ fontSize: "0.9em", color: "#666", marginBottom: 15 }}>
                                    URL: <a href={`https://${p.slug}.myplatform.com`} target="_blank" rel="noreferrer">
                                        {p.slug}.myplatform.com
                                    </a>
                                </div>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ 
                                        padding: "4px 10px", borderRadius: 20, fontSize: "0.8em",
                                        background: p.deploymentStatus === "DEPLOYED" ? "#e8f5e9" : "#fff3e0",
                                        color: p.deploymentStatus === "DEPLOYED" ? "#2e7d32" : "#ef6c00"
                                    }}>
                                        {p.deploymentStatus || "IDLE"}
                                    </span>
                                    <button onClick={() => {}} style={{ fontSize: "0.8em" }}>View Logs</button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

