import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clearToken, getToken } from "../lib/auth";

export default function Dashboard() {
    const nav = useNavigate();
    const [user, setUser] = useState(null);
    const [err, setErr] = useState("");
    const [repos, setRepos] = useState(null);
    const [loadingRepos, setLoadingRepos] = useState(false);
    const [repoError, setRepoError] = useState("");
    
    // New state for selection
    const [analyzing, setAnalyzing] = useState(false);
    const [selectedProject, setSelectedProject] = useState(null);

    // Branch selection state
    const [repoSelection, setRepoSelection] = useState(null); // The repo being configured
    const [branches, setBranches] = useState([]);
    const [loadingBranches, setLoadingBranches] = useState(false);
    const [selectedBranch, setSelectedBranch] = useState("");
    const [cloning, setCloning] = useState(false);

    const fetchRepos = async () => {
        setLoadingRepos(true);
        setRepoError("");
        try {
            const token = getToken();
            const data = await apiFetch("/api/github/repos", { token });
            setRepos(data.repos);
        } catch (e) {
            setRepoError(e.message);
        } finally {
            setLoadingRepos(false);
        }
    };

    const cloneProject = async () => {
        if (!selectedProject) return;
        setCloning(true);
        try {
            const token = getToken();
            const res = await apiFetch("/api/projects/clone", {
                method: "POST",
                token,
                body: { projectId: selectedProject.id }
            });
            setSelectedProject(res.project);
        } catch (e) {
            alert("Cloning failed: " + e.message);
        } finally {
            setCloning(false);
        }
    };

    const initiateSelection = async (repo) => {
        setRepoSelection(repo);
        setSelectedProject(null);
        setBranches([]);
        setLoadingBranches(true);
        
        try {
            const token = getToken();
            const data = await apiFetch(`/api/github/branches?repo=${repo.full_name}`, { token });
            setBranches(data.branches);
            
            // Auto-select default branch
            const def = data.branches.find(b => b.name === repo.default_branch) || data.branches[0];
            setSelectedBranch(def?.name || "main");
        } catch (e) {
            alert("Failed to fetch branches: " + e.message);
            setRepoSelection(null); // Reset on error
        } finally {
            setLoadingBranches(false);
        }
    };

    const confirmSelection = async () => {
        if (!repoSelection || !selectedBranch) return;

        setAnalyzing(true);
        try {
            const token = getToken();
            const res = await apiFetch("/api/projects/import", {
                method: "POST",
                token,
                body: { 
                    repoFullName: repoSelection.full_name, 
                    repoId: repoSelection.id,
                    branch: selectedBranch 
                }
            });
            setSelectedProject(res.project);
            setRepoSelection(null); // Clear selection mode
        } catch (e) {
            alert("Failed to analyze repo: " + e.message);
        } finally {
            setAnalyzing(false);
        }
    };

    useEffect(() => {
        const token = getToken();
        if (!token) {
            nav("/login");
            return;
        }

        apiFetch("/api/me", { token })
            .then((d) => setUser(d.user))
            .catch((e) => {
                setErr(e.message);
                clearToken();
                nav("/login");
            });
    }, [nav]);

    function logout() {
        clearToken();
        nav("/login");
    }

    return (
        <div style={{ maxWidth: 800, margin: "40px auto", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <h2>Dashboard</h2>
                <button onClick={logout}>Logout</button>
            </div>

            {err ? <div style={{ color: "crimson" }}>{err}</div> : null}

            {!user ? (
                <p>Loading...</p>
            ) : (
                <div style={{ marginTop: 16 }}>
                    <div><b>Email:</b> {user.email}</div>
                    <div><b>GitHub:</b> {user.github ? `Connected as ${user.github.username}` : "Not connected"}</div>

                    <div style={{ marginTop: 20, padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
                        {/* <h3 style={{ marginTop: 0 }}>Next step</h3>
            <p style={{ marginBottom: 0 }}>
              We’ll add “Connect GitHub” button here and start OAuth.
            </p> */}
                        {!user.github ? (
                            <button
                                onClick={() => {
                                    const token = getToken();
                                    window.location.href = `http://localhost:5000/api/github/connect?token=${token}`;
                                }}
                            >
                                Connect GitHub
                            </button>
                        ) : (
                            <div>
                                <p>GitHub connected ✅</p>
                                <button onClick={fetchRepos} disabled={loadingRepos} style={{ marginTop: 8 }}>
                                    {loadingRepos ? "Loading..." : "List GitHub Repositories"}
                                </button>
                                {repoError && <p style={{ color: "crimson" }}>{repoError}</p>}

                                {repos && !repoSelection && !selectedProject && (
                                    <div style={{ marginTop: 12 }}>
                                        <h4>Repositories ({repos.length})</h4>
                                        <ul style={{ maxHeight: 300, overflowY: "auto", paddingLeft: 20 }}>
                                            {repos.map((r) => (
                                                <li key={r.id} style={{ marginBottom: 6 }}>
                                                    <b>{r.full_name}</b>
                                                    {r.private ? " 🔒" : ""}
                                                    <button 
                                                        onClick={() => initiateSelection(r)} 
                                                        style={{ marginLeft: 10, fontSize: "0.8em" }}
                                                    >
                                                        Select
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Branch Selection Mode */}
                                {repoSelection && (
                                    <div style={{ marginTop: 20, padding: 12, border: "1px solid #aaa", borderRadius: 8, background: "#f9f9f9" }}>
                                        <h3 style={{ marginTop: 0 }}>Configure: {repoSelection.full_name}</h3>
                                        
                                        {loadingBranches ? (
                                            <p>Loading branches...</p>
                                        ) : (
                                            <div>
                                                <label style={{ display: "block", marginBottom: 8 }}>
                                                    Select Branch:
                                                    <select 
                                                        value={selectedBranch} 
                                                        onChange={(e) => setSelectedBranch(e.target.value)}
                                                        style={{ marginLeft: 10, padding: 4 }}
                                                    >
                                                        {branches.map(b => (
                                                            <option key={b.name} value={b.name}>
                                                                {b.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
                                                    <button onClick={confirmSelection} disabled={analyzing}>
                                                        {analyzing ? "Analyzing..." : "Analyze & Import"}
                                                    </button>
                                                    <button onClick={() => setRepoSelection(null)} disabled={analyzing} style={{ background: "#ccc" }}>
                                                        Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                                
                                {/* Result */}
                                {selectedProject && (
                                    <div style={{ marginTop: 20, padding: 12, border: "2px solid #4CAF50", borderRadius: 8 }}>
                                        <h3 style={{ margin: "0 0 10px 0" }}>Project Ready 🚀</h3>
                                        <div><b>Repo:</b> {selectedProject.repoFullName}</div>
                                        <div><b>Branch:</b> {selectedProject.branch}</div>
                                        <div><b>Detected Framework:</b> {selectedProject.framework}</div>
                                        
                                        <hr style={{ margin: "12px 0", border: "0", borderTop: "1px solid #eee" }} />

                                        {/* Cloning Section */}
                                        {selectedProject.cloneStatus === "CLONED" ? (
                                            <div>
                                                <div style={{ color: "green", fontWeight: "bold" }}>Workspace Ready ✅</div>
                                                <div style={{ marginTop: 10, color: "#666" }}>
                                                    Next step: Generate Dockerfile & Deploy (Coming soon)
                                                </div>
                                            </div>
                                        ) : (
                                            <div>
                                                <p style={{ marginBottom: 10 }}>Workspace not prepared.</p>
                                                <button 
                                                    onClick={cloneProject} 
                                                    disabled={cloning}
                                                    style={{ background: "#007BFF", color: "white" }}
                                                >
                                                    {cloning ? "Cloning Repository..." : "Prepare Workspace (Clone)"}
                                                </button>
                                                {selectedProject.cloneStatus === "FAILED" && (
                                                    <p style={{ color: "red", marginTop: 5 }}>Last clone attempt failed.</p>
                                                )}
                                            </div>
                                        )}

                                        <button 
                                            onClick={() => setSelectedProject(null)} 
                                            style={{ marginTop: 12, fontSize: "0.8em", background: "none", color: "#666", border: "none", textDecoration: "underline", cursor: "pointer" }}
                                        >
                                            Select Another
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>
                </div>
            )}
        </div>
    );
}
