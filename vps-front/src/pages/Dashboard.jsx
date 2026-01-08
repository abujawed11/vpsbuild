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

                                {repos && (
                                    <div style={{ marginTop: 12 }}>
                                        <h4>Repositories ({repos.length})</h4>
                                        <ul style={{ maxHeight: 300, overflowY: "auto", paddingLeft: 20 }}>
                                            {repos.map((r) => (
                                                <li key={r.id}>
                                                    <a href={r.html_url} target="_blank" rel="noreferrer">
                                                        {r.full_name}
                                                    </a>
                                                    {r.private ? " 🔒" : ""}
                                                </li>
                                            ))}
                                        </ul>
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
