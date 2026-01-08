import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clearToken, getToken } from "../lib/auth";

export default function Dashboard() {
    const nav = useNavigate();
    const [user, setUser] = useState(null);
    const [err, setErr] = useState("");

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
                            <p>GitHub connected ✅</p>
                        )}

                    </div>
                </div>
            )}
        </div>
    );
}
