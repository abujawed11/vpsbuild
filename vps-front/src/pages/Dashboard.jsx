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
    const [analyzingWorkspace, setAnalyzingWorkspace] = useState(false);
    
    // Folder Picker State
    const [showFolderPicker, setShowFolderPicker] = useState(false);
    const [folderTree, setFolderTree] = useState(null);
    const [loadingTree, setLoadingTree] = useState(false);
    const [selectedFrontend, setSelectedFrontend] = useState("");
    const [selectedBackend, setSelectedBackend] = useState("");
    const [savingRoots, setSavingRoots] = useState(false);

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

    const fetchTree = async () => {
        if (!selectedProject) return;
        setLoadingTree(true);
        try {
            const token = getToken();
            const data = await apiFetch(`/api/projects/${selectedProject.id}/tree`, { token });
            setFolderTree(data.tree);
            // Pre-select existing roots if any
            if (selectedProject.frontendRoot) setSelectedFrontend(selectedProject.frontendRoot);
            if (selectedProject.backendRoot) setSelectedBackend(selectedProject.backendRoot);
        } catch (e) {
            alert("Failed to load folder tree: " + e.message);
        } finally {
            setLoadingTree(false);
        }
    };

    const saveRoots = async () => {
        setSavingRoots(true);
        try {
            const token = getToken();
            await apiFetch(`/api/projects/${selectedProject.id}/roots`, {
                method: "POST",
                token,
                body: { frontendRoot: selectedFrontend || null, backendRoot: selectedBackend || null }
            });
            setShowFolderPicker(false);
            // Re-analyze
            await analyzeProject();
        } catch (e) {
            alert("Failed to save folders: " + e.message);
        } finally {
            setSavingRoots(false);
        }
    };

    const openFolderPicker = () => {
        setShowFolderPicker(true);
        fetchTree();
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

    const analyzeProject = async () => {
        if (!selectedProject) return;
        setAnalyzingWorkspace(true);
        try {
            const token = getToken();
            const res = await apiFetch("/api/projects/analyze", {
                method: "POST",
                token,
                body: { projectId: selectedProject.id }
            });
            setSelectedProject(res.project);
        } catch (e) {
            alert("Analysis failed: " + e.message);
        } finally {
            setAnalyzingWorkspace(false);
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
            {/* Modal Overlay */}
            {showFolderPicker && (
                <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000
                }}>
                    <div style={{ background: "white", padding: 20, borderRadius: 8, width: 600, maxHeight: "80vh", overflowY: "auto" }}>
                        <h3>Configure App Folders</h3>
                        <p style={{ fontSize: "0.9em", color: "#666" }}>
                            Select the folders containing your Frontend and Backend code. 
                            If you have a monorepo, select the specific subfolders.
                        </p>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 20 }}>
                            <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 4 }}>
                                <b>Frontend Root:</b>
                                <div style={{ color: selectedFrontend ? "blue" : "#aaa" }}>
                                    {selectedFrontend === "." ? "Project Root" : (selectedFrontend || "(Not set)")}
                                </div>
                                {selectedFrontend && <button onClick={() => setSelectedFrontend("")} style={{ fontSize: "0.8em" }}>Clear</button>}
                            </div>
                            <div style={{ padding: 10, background: "#f5f5f5", borderRadius: 4 }}>
                                <b>Backend Root:</b>
                                <div style={{ color: selectedBackend ? "blue" : "#aaa" }}>
                                    {selectedBackend === "." ? "Project Root" : (selectedBackend || "(Not set)")}
                                </div>
                                {selectedBackend && <button onClick={() => setSelectedBackend("")} style={{ fontSize: "0.8em" }}>Clear</button>}
                            </div>
                        </div>

                        <div style={{ border: "1px solid #ddd", padding: 10, borderRadius: 4, maxHeight: 300, overflowY: "auto" }}>
                            {loadingTree ? (
                                <p>Loading folders...</p>
                            ) : folderTree ? (
                                <FolderTree 
                                    node={folderTree} 
                                    onSelectFrontend={setSelectedFrontend} 
                                    onSelectBackend={setSelectedBackend} 
                                />
                            ) : (
                                <p>No files found.</p>
                            )}
                        </div>

                        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
                            <button onClick={() => setShowFolderPicker(false)} style={{ background: "#ccc" }}>Cancel</button>
                            <button onClick={saveRoots} disabled={savingRoots} style={{ background: "#2196F3", color: "white" }}>
                                {savingRoots ? "Saving..." : "Save & Re-Analyze"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                                                
                                                {selectedProject.analysisStatus !== "ANALYZED" ? (
                                                    <button 
                                                        onClick={analyzeProject} 
                                                        disabled={analyzingWorkspace}
                                                        style={{ marginTop: 10, background: "#673AB7", color: "white" }}
                                                    >
                                                        {analyzingWorkspace ? "Analyzing..." : "Analyze Workspace"}
                                                    </button>
                                                ) : (
                                                    <div style={{ marginTop: 16, background: "#f0f0f0", padding: 12, borderRadius: 8 }}>
                                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                                                            <h4 style={{ margin: 0 }}>Deployment Plan 📋</h4>
                                                            <button onClick={openFolderPicker} style={{ fontSize: "0.8em" }}>
                                                                Configure folders
                                                            </button>
                                                        </div>
                                                        <div style={{ fontSize: "0.9em", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                                                            <div><b>Runtime:</b> {selectedProject.runtime}</div>
                                                            <div><b>Framework:</b> {selectedProject.framework}</div>
                                                            <div><b>Pkg Manager:</b> {selectedProject.packageManager}</div>
                                                            <div><b>Port:</b> {selectedProject.port}</div>
                                                            <div style={{ gridColumn: "1 / -1" }}><b>Build Cmd:</b> {selectedProject.buildCommand || "(none)"}</div>
                                                            <div style={{ gridColumn: "1 / -1" }}><b>Start Cmd:</b> {selectedProject.startCommand || "(none)"}</div>
                                                        </div>
                                                        <div style={{ marginTop: 12, color: "#666" }}>
                                                            Next step: Generate Dockerfile & Deploy (Coming soon)
                                                        </div>
                                                    </div>
                                                )}

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

function FolderTree({ node, onSelectFrontend, onSelectBackend }) {
    if (!node) return null;

    const isRoot = node.path === ".";
    
    return (
        <div style={{ marginLeft: isRoot ? 0 : 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                <span style={{ fontWeight: isRoot ? "bold" : "normal" }}>
                    {isRoot ? "📂 Project Root" : `📁 ${node.name}`}
                </span>
                {/* Signals */}
                {node.signals && node.signals.length > 0 && (
                    <span style={{ fontSize: "0.7em", background: "#e0e0e0", padding: "2px 6px", borderRadius: 4 }}>
                        {node.signals.join(", ")}
                    </span>
                )}
                
                <button onClick={() => onSelectFrontend(node.path)} style={{ fontSize: "0.7em", padding: "2px 6px" }}>
                    Set Frontend
                </button>
                <button onClick={() => onSelectBackend(node.path)} style={{ fontSize: "0.7em", padding: "2px 6px" }}>
                    Set Backend
                </button>
            </div>
            
            {node.children && node.children.map((child) => (
                <FolderTree 
                    key={child.path} 
                    node={child} 
                    onSelectFrontend={onSelectFrontend} 
                    onSelectBackend={onSelectBackend} 
                />
            ))}
        </div>
    );
}
