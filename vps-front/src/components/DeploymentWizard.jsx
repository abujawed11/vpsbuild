import { useState, useEffect } from "react";
import { getToken } from "../lib/auth";
import { apiFetch } from "../lib/api";

export default function DeploymentWizard({ onComplete, onCancel }) {
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    
    // Step 1: Create Site
    const [siteName, setSiteName] = useState("");
    const [siteSlug, setSiteSlug] = useState("");
    
    // Step 2: Choose Source
    const [repos, setRepos] = useState([]);
    const [selectedRepo, setSelectedRepo] = useState(null);
    const [branches, setBranches] = useState([]);
    const [selectedBranch, setSelectedBranch] = useState("");

    // Step 3: Select Root
    const [projectId, setProjectId] = useState(null);
    const [projectData, setProjectData] = useState(null);
    const [folderTree, setFolderTree] = useState(null);
    const [selectedRoot, setSelectedRoot] = useState("/");

    // Step 4: Build Settings
    const [buildSettings, setBuildSettings] = useState({
        packageManager: "npm",
        buildCommand: "",
        outputDir: "dist",
        spaRouting: true
    });

    // Step 5: Env Vars
    const [envVars, setEnvVars] = useState([]);
    const [newEnv, setNewEnv] = useState({ key: "", value: "" });

    // Step 6: Deploy
    const [deployment, setDeployment] = useState(null);
    const [logs, setLogs] = useState("");

    // Effects
    useEffect(() => {
        if (siteName && step === 1) {
            setSiteSlug(siteName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 50));
        }
    }, [siteName, step]);

    const fetchRepos = async () => {
        setLoading(true);
        try {
            const data = await apiFetch("/github/repos", { token: getToken() });
            setRepos(data.repos);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const fetchBranches = async (repo) => {
        setLoading(true);
        try {
            const data = await apiFetch(`/github/branches?repo=${repo.full_name}`, { token: getToken() });
            setBranches(data.branches);
            setSelectedBranch(repo.default_branch || data.branches[0]?.name);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const createProject = async () => {
        setLoading(true);
        try {
            const res = await apiFetch("/projects/import", {
                method: "POST",
                token: getToken(),
                body: { 
                    repoFullName: selectedRepo.full_name, 
                    branch: selectedBranch,
                    name: siteName,
                    slug: siteSlug
                }
            });
            setProjectId(res.project.id);
            setProjectData(res.project);

            // Clone and analyze
            await apiFetch("/projects/clone", { method: "POST", token: getToken(), body: { projectId: res.project.id } });
            const treeData = await apiFetch(`/projects/${res.project.id}/tree`, { token: getToken() });
            setFolderTree(treeData.tree);
            setStep(3);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const detectSettings = async (path) => {
        setLoading(true);
        try {
            // Update project with rootDir first
            await apiFetch(`/projects/${projectId}`, {
                method: "PATCH",
                token: getToken(),
                body: { rootDir: path }
            });

            const res = await apiFetch("/projects/analyze", {
                method: "POST",
                token: getToken(),
                body: { projectId }
            });
            setBuildSettings({
                packageManager: res.project.packageManager || "npm",
                buildCommand: res.project.buildCommand || "",
                outputDir: res.project.outputDir || "dist",
                spaRouting: true
            });
            setStep(4);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const saveSettings = async () => {
        setLoading(true);
        try {
            await apiFetch(`/projects/${projectId}`, {
                method: "PATCH",
                token: getToken(),
                body: { ...buildSettings }
            });
            setStep(5);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const startDeploy = async () => {
        setLoading(true);
        try {
            const res = await apiFetch(`/deployments/${projectId}`, {
                method: "POST",
                token: getToken()
            });
            setDeployment({ id: res.deploymentId, status: "QUEUED" });
            setStep(6);
            pollLogs(res.deploymentId);
        } catch (e) { alert(e.message); }
        setLoading(false);
    };

    const pollLogs = (id) => {
        const interval = setInterval(async () => {
            try {
                const res = await apiFetch(`/deployments/status/${id}`, { token: getToken() });
                setLogs(res.logs);
                setDeployment(res);
                if (res.status === "DEPLOYED" || res.status === "FAILED") {
                    clearInterval(interval);
                }
            } catch (e) { clearInterval(interval); }
        }, 2000);
    };

    // Auto-scroll logs
    const logContainerRef = useState(null); // Ref pattern with state for callback? No, standard useRef.
    // Actually, let's just use an ID or a proper ref.
    // Since I can't easily change imports to add useRef without replacing the top, 
    // I'll use a callback ref or just document.getElementById (simplest for this replacement).
    
    useEffect(() => {
        const el = document.getElementById("log-container");
        if (el) el.scrollTop = el.scrollHeight;
    }, [logs]);

    const addEnvVar = () => {
        if (!newEnv.key) return;
        setEnvVars([...envVars, newEnv]);
        setNewEnv({ key: "", value: "" });
    };

    return (
        <div style={{ background: "white", padding: 30, borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.08)" }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 30 }}>
                {[1, 2, 3, 4, 5, 6].map(s => (
                    <div key={s} style={{ 
                        height: 6, flex: 1, 
                        background: step >= s ? "#2196F3" : "#e0e0e0",
                        borderRadius: 3,
                        transition: "background 0.3s ease"
                    }} />
                ))}
            </div>

            {step === 1 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step 1: Name Your Site</h3>
                    <p style={stepDesc}>Give your project a name. We'll generate a unique URL for it.</p>
                    <div style={{ marginBottom: 20 }}>
                        <label style={labelStyle}>Site Name</label>
                        <input 
                            value={siteName} 
                            onChange={e => setSiteName(e.target.value)} 
                            placeholder="My Awesome Site" 
                            style={inputStyle} 
                            autoFocus
                        />
                    </div>
                    <div style={{ marginBottom: 25 }}>
                        <label style={labelStyle}>Site URL</label>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#f5f5f5", padding: "8px 12px", borderRadius: 6, border: "1px solid #ddd" }}>
                            <span style={{ color: "#888" }}>https://</span>
                            <input 
                                value={siteSlug} 
                                onChange={e => setSiteSlug(e.target.value)} 
                                style={{ ...inputStyle, border: "none", background: "transparent", padding: 0, fontWeight: 500 }} 
                            />
                            <span style={{ color: "#888" }}>.{import.meta.env.VITE_BASE_DOMAIN || 'localhost'}</span>
                        </div>
                    </div>
                    <button onClick={() => { fetchRepos(); setStep(2); }} disabled={!siteSlug} style={primaryBtn}>
                        Next: Choose Source →
                    </button>
                </div>
            )}

            {step === 2 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step 2: Choose Source</h3>
                    <p style={stepDesc}>Connect a GitHub repository to deploy.</p>
                    {loading ? <p>Loading repos...</p> : (
                        <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 20 }}>
                            {repos.map(r => (
                                <div key={r.id} onClick={() => { setSelectedRepo(r); fetchBranches(r); }} style={{ 
                                    padding: "12px 16px", cursor: "pointer", borderBottom: "1px solid #f0f0f0",
                                    background: selectedRepo?.id === r.id ? "#e3f2fd" : "white",
                                    display: "flex", justifyContent: "space-between", alignItems: "center"
                                }}>
                                    <span style={{ fontWeight: 500 }}>{r.full_name}</span>
                                    {r.private && <span style={{ fontSize: "0.7em", background: "#eee", padding: "2px 6px", borderRadius: 4 }}>PRIVATE</span>}
                                </div>
                            ))}
                        </div>
                    )}
                    {selectedRepo && (
                        <div style={{ marginBottom: 20 }}>
                            <label style={labelStyle}>Select Branch</label>
                            <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} style={inputStyle}>
                                {branches.map(b => <option key={b.name} value={b.name}>{b.name}</option>)}
                            </select>
                        </div>
                    )}
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(1)} style={secondaryBtn}>Back</button>
                        <button onClick={createProject} disabled={!selectedBranch || loading} style={primaryBtn}>
                            {loading ? "Initializing..." : "Next: Select Root →"}
                        </button>
                    </div>
                </div>
            )}

            {step === 3 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step 3: Select Root Folder</h3>
                    <p style={stepDesc}>Where does your frontend code live? (Usually root or a subfolder like /frontend)</p>
                    <div style={{ border: "1px solid #eee", padding: 10, borderRadius: 8, maxHeight: 300, overflowY: "auto", marginBottom: 20, background: "#fafafa" }}>
                        {folderTree && <SimpleFolderTree tree={folderTree} onSelect={setSelectedRoot} selected={selectedRoot} />}
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", background: "#e3f2fd", padding: 10, borderRadius: 6, marginBottom: 20 }}>
                        <span style={{ fontSize: "0.9em", color: "#1565c0" }}>Selected: <b>{selectedRoot}</b></span>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(2)} style={secondaryBtn}>Back</button>
                        <button onClick={() => detectSettings(selectedRoot)} disabled={loading} style={primaryBtn}>
                            {loading ? "Detecting..." : "Next: Build Settings →"}
                        </button>
                    </div>
                </div>
            )}

            {step === 4 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step 4: Build Settings</h3>
                    <p style={stepDesc}>We auto-detected these settings. Tweaks allowed.</p>
                    <div style={{ display: "grid", gap: 20, marginBottom: 25 }}>
                        <div>
                            <label style={labelStyle}>Package Manager</label>
                            <select value={buildSettings.packageManager} onChange={e => setBuildSettings({...buildSettings, packageManager: e.target.value})} style={inputStyle}>
                                <option value="npm">npm</option>
                                <option value="yarn">yarn</option>
                                <option value="pnpm">pnpm</option>
                                <option value="static">None (Static HTML)</option>
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Build Command</label>
                            <input value={buildSettings.buildCommand} onChange={e => setBuildSettings({...buildSettings, buildCommand: e.target.value})} placeholder="e.g. npm run build" style={inputStyle} />
                        </div>
                        <div>
                            <label style={labelStyle}>Output Directory</label>
                            <input value={buildSettings.outputDir} onChange={e => setBuildSettings({...buildSettings, outputDir: e.target.value})} placeholder="e.g. dist" style={inputStyle} />
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                            <input type="checkbox" checked={buildSettings.spaRouting} onChange={e => setBuildSettings({...buildSettings, spaRouting: e.target.checked})} style={{ width: 18, height: 18 }} />
                            <span><b>SPA Routing</b> (Redirect 404s to index.html)</span>
                        </label>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(3)} style={secondaryBtn}>Back</button>
                        <button onClick={saveSettings} style={primaryBtn}>Next: Env Vars →</button>
                    </div>
                </div>
            )}

            {step === 5 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Step 5: Environment Variables</h3>
                    <p style={stepDesc}>Add keys like VITE_API_URL. (Build-time only)</p>
                    <div style={{ marginBottom: 25 }}>
                        {envVars.length > 0 && (
                            <div style={{ marginBottom: 15, border: "1px solid #eee", borderRadius: 6, overflow: "hidden" }}>
                                {envVars.map((ev, i) => (
                                    <div key={i} style={{ display: "flex", gap: 10, padding: 8, background: i % 2 ? "#fafafa" : "white", borderBottom: "1px solid #eee" }}>
                                        <div style={{ flex: 1, fontFamily: "monospace", fontWeight: 600 }}>{ev.key}</div>
                                        <div style={{ flex: 1, fontFamily: "monospace", color: "#666" }}>{ev.value}</div>
                                        <button onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "crimson", cursor: "pointer" }}>✕</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div style={{ display: "flex", gap: 10 }}>
                            <input placeholder="KEY (e.g. API_URL)" value={newEnv.key} onChange={e => setNewEnv({...newEnv, key: e.target.value.toUpperCase()})} style={{ ...inputStyle, flex: 1 }} />
                            <input placeholder="Value" value={newEnv.value} onChange={e => setNewEnv({...newEnv, value: e.target.value})} style={{ ...inputStyle, flex: 1 }} />
                            <button onClick={addEnvVar} style={{ background: "#333", color: "white", padding: "0 15px", borderRadius: 4, border: "none", cursor: "pointer" }}>Add</button>
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                        <button onClick={() => setStep(4)} style={secondaryBtn}>Back</button>
                        <button onClick={startDeploy} style={{ ...primaryBtn, background: "#00C853" }}>Deploy Now 🚀</button>
                    </div>
                </div>
            )}

            {step === 6 && (
                <div className="fade-in">
                    <h3 style={stepTitle}>Building & Deploying...</h3>
                    <div id="log-container" style={{ 
                        background: "#1e1e1e", color: "#a9b7c6", padding: 20, borderRadius: 8, 
                        height: 350, overflowY: "auto", fontFamily: "Consolas, Monaco, monospace", fontSize: "0.85em",
                        boxShadow: "inset 0 2px 10px rgba(0,0,0,0.5)" 
                    }}>
                        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            {logs || "Initializing build environment..."}
                        </pre>
                        {/* Anchor for auto-scroll */}
                        <div style={{ height: 1 }} />
                    </div>
                    
                    {deployment?.status === "DEPLOYED" && (() => {
                        const slug = projectData?.slug || siteSlug;
                        const domain = import.meta.env.VITE_BASE_DOMAIN || 'localhost';
                        const port = import.meta.env.VITE_PORT ? `:${import.meta.env.VITE_PORT}` : '';
                        const siteUrl = `http://${slug}.${domain}${port}`;

                        return (
                            <div style={{ marginTop: 25, textAlign: "center", padding: 20, background: "#e8f5e9", borderRadius: 8, border: "1px solid #c8e6c9" }}>
                                <h2 style={{ color: "#2e7d32", marginTop: 0 }}>Deployment Complete! 🎉</h2>
                                <p>Your site is verified and live.</p>
                                <a href={siteUrl} target="_blank" rel="noreferrer" style={{
                                    display: "inline-block", marginTop: 10, padding: "10px 20px",
                                    background: "#2e7d32", color: "white", textDecoration: "none", borderRadius: 6, fontWeight: "bold"
                                }}>
                                    Visit {slug}.{domain}{port}
                                </a>
                                <div style={{ marginTop: 15 }}>
                                    <button onClick={onComplete} style={{ background: "transparent", border: "none", textDecoration: "underline", cursor: "pointer", color: "#2e7d32" }}>Back to Dashboard</button>
                                </div>
                            </div>
                        );
                    })()}
                    {deployment?.status === "FAILED" && (
                        <div style={{ marginTop: 20, textAlign: "center", color: "crimson" }}>
                            <h3>Deployment Failed ❌</h3>
                            <button onClick={() => setStep(4)} style={secondaryBtn}>Review Settings</button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function SimpleFolderTree({ tree, onSelect, selected, depth = 0 }) {
    return (
        <div style={{ paddingLeft: depth === 0 ? 0 : 20 }}>
            <div 
                onClick={() => onSelect(tree.path)}
                style={{ 
                    padding: "6px 8px", cursor: "pointer", 
                    background: selected === tree.path ? "#e3f2fd" : "transparent",
                    color: selected === tree.path ? "#1565c0" : "inherit",
                    borderRadius: 4, display: "flex", alignItems: "center", gap: 6
                }}
            >
                <span>{tree.name === "(root)" ? "📂 Project Root" : "📁 " + tree.name}</span>
            </div>
            {tree.children && tree.children.filter(c => c.type === "folder").map(child => (
                <SimpleFolderTree key={child.path} tree={child} onSelect={onSelect} selected={selected} depth={depth + 1} />
            ))}
        </div>
    );
}

// Styles
const stepTitle = { marginTop: 0, marginBottom: 5, fontSize: "1.5em", color: "#333" };
const stepDesc = { margin: "0 0 20px 0", color: "#666", fontSize: "0.95em" };
const labelStyle = { display: "block", marginBottom: 6, fontWeight: 500, fontSize: "0.9em", color: "#444" };
const inputStyle = { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 6, fontSize: "1em" };
const primaryBtn = { background: "#2196F3", color: "white", padding: "10px 20px", border: "none", borderRadius: 6, cursor: "pointer", fontSize: "1em", fontWeight: 500, flex: 1 };
const secondaryBtn = { background: "#f5f5f5", color: "#333", padding: "10px 20px", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", fontSize: "1em", fontWeight: 500 };

