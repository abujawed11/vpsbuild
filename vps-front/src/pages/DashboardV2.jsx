import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clearToken, getToken } from "../lib/auth";
import ImportRepository from "../components/ImportRepository";
import ProjectView from "../components/ProjectView";

export default function DashboardV2() {
  const nav = useNavigate();
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      nav("/login");
      return;
    }

    apiFetch("/api/me", { token })
      .then((d) => setUser(d.user))
      .catch((e) => {
        setError(e.message);
        clearToken();
        nav("/login");
      });
  }, [nav]);

  function logout() {
    clearToken();
    nav("/login");
  }

  if (!user) {
    return (
      <div style={{ maxWidth: 1200, margin: "40px auto", padding: 24 }}>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f5f7fa" }}>
      {/* Header */}
      <header
        style={{
          background: "white",
          borderBottom: "1px solid #e1e4e8",
          padding: "16px 24px",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
              VPS Deploy
            </h1>
            {selectedProject && (
              <span
                style={{
                  color: "#666",
                  fontSize: 14,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
                onClick={() => setSelectedProject(null)}
              >
                ← Back to projects
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={{ fontSize: 14, color: "#666" }}>{user.email}</span>
            <button
              onClick={logout}
              style={{
                padding: "8px 16px",
                background: "white",
                border: "1px solid #e1e4e8",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
        {error && (
          <div
            style={{
              background: "#fff1f0",
              border: "1px solid #ffa39e",
              borderRadius: 6,
              padding: 16,
              marginBottom: 24,
              color: "#cf1322",
            }}
          >
            {error}
          </div>
        )}

        {!user.github ? (
          <div
            style={{
              background: "white",
              borderRadius: 8,
              padding: 48,
              textAlign: "center",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: 24 }}>
              Connect your GitHub account
            </h2>
            <p style={{ color: "#666", marginBottom: 32 }}>
              Connect GitHub to start deploying your projects
            </p>
            <button
              onClick={() => {
                const token = getToken();
                window.location.href = `http://localhost:5000/api/github/connect?token=${token}`;
              }}
              style={{
                padding: "12px 24px",
                background: "#24292e",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 16,
                fontWeight: 500,
              }}
            >
              Connect GitHub
            </button>
          </div>
        ) : selectedProject ? (
          <ProjectView
            projectId={selectedProject}
            onBack={() => setSelectedProject(null)}
          />
        ) : (
          <ImportRepository onProjectCreated={setSelectedProject} />
        )}
      </main>
    </div>
  );
}
