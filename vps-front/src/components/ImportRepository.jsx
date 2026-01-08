import { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import { getToken } from "../lib/auth";
import { importRepository } from "../lib/api-v2";

export default function ImportRepository({ onProjectCreated }) {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(null);
  const [search, setSearch] = useState("");

  // Branch selection state
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");

  useEffect(() => {
    fetchRepos();
  }, []);

  async function fetchRepos() {
    setLoading(true);
    setError("");
    try {
      const token = getToken();
      const data = await apiFetch("/api/github/repos", { token });
      setRepos(data.repos);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function selectRepo(repo) {
    setSelectedRepo(repo);
    setLoadingBranches(true);
    setBranches([]);

    try {
      const token = getToken();
      const data = await apiFetch(
        `/api/github/branches?repo=${repo.full_name}`,
        { token }
      );
      setBranches(data.branches);

      // Auto-select default branch
      const defaultBranch =
        data.branches.find((b) => b.name === repo.default_branch) ||
        data.branches[0];
      setSelectedBranch(defaultBranch?.name || "main");
    } catch (e) {
      setError("Failed to fetch branches: " + e.message);
      setSelectedRepo(null);
    } finally {
      setLoadingBranches(false);
    }
  }

  async function handleImport() {
    if (!selectedRepo || !selectedBranch) return;

    setImporting(selectedRepo.full_name);
    try {
      const result = await importRepository(
        selectedRepo.full_name,
        selectedBranch
      );
      onProjectCreated(result.project.id);
    } catch (e) {
      setError("Failed to import: " + e.message);
      setImporting(null);
    }
  }

  const filteredRepos = repos.filter((r) =>
    r.full_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 28, fontWeight: 600 }}>
          Import Git Repository
        </h2>
        <p style={{ color: "#666", margin: "8px 0 0 0" }}>
          Select a repository to deploy. We'll automatically detect your project
          structure.
        </p>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 24 }}>
        <input
          type="text"
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 16px",
            fontSize: 14,
            border: "1px solid #e1e4e8",
            borderRadius: 6,
            outline: "none",
          }}
        />
      </div>

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

      {loading ? (
        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 48,
            textAlign: "center",
          }}
        >
          <p style={{ color: "#666" }}>Loading repositories...</p>
        </div>
      ) : selectedRepo ? (
        /* Branch Selection */
        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            border: "1px solid #e1e4e8",
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 20, fontWeight: 600 }}>
            Configure: {selectedRepo.full_name}
          </h3>

          {loadingBranches ? (
            <p style={{ color: "#666" }}>Loading branches...</p>
          ) : (
            <>
              <div style={{ marginBottom: 24 }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: 8,
                    fontSize: 14,
                    fontWeight: 500,
                  }}
                >
                  Production Branch:
                </label>
                <select
                  value={selectedBranch}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    fontSize: 14,
                    border: "1px solid #e1e4e8",
                    borderRadius: 6,
                    background: "white",
                  }}
                >
                  {branches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                      {b.name === selectedRepo.default_branch && " (default)"}
                    </option>
                  ))}
                </select>
                <p style={{ fontSize: 12, color: "#666", margin: "8px 0 0 0" }}>
                  This branch will be deployed to production. You can deploy other
                  branches as previews later.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 12,
                  justifyContent: "flex-end",
                }}
              >
                <button
                  onClick={() => setSelectedRepo(null)}
                  disabled={importing}
                  style={{
                    padding: "10px 20px",
                    background: "white",
                    color: "#24292e",
                    border: "1px solid #e1e4e8",
                    borderRadius: 6,
                    cursor: importing ? "not-allowed" : "pointer",
                    fontSize: 14,
                    fontWeight: 500,
                    opacity: importing ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  style={{
                    padding: "10px 20px",
                    background: "#2da44e",
                    color: "white",
                    border: "none",
                    borderRadius: 6,
                    cursor: importing ? "not-allowed" : "pointer",
                    fontSize: 14,
                    fontWeight: 500,
                    opacity: importing ? 0.5 : 1,
                  }}
                >
                  {importing ? "Importing..." : "Import & Continue →"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        /* Repository List */
        <div
          style={{
            background: "white",
            borderRadius: 8,
            border: "1px solid #e1e4e8",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "16px 24px",
              borderBottom: "1px solid #e1e4e8",
              background: "#f6f8fa",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            {filteredRepos.length} repositories
          </div>

          <div style={{ maxHeight: 600, overflowY: "auto" }}>
            {filteredRepos.length === 0 ? (
              <div style={{ padding: 48, textAlign: "center", color: "#666" }}>
                No repositories found
              </div>
            ) : (
              filteredRepos.map((repo) => (
                <div
                  key={repo.id}
                  style={{
                    padding: "16px 24px",
                    borderBottom: "1px solid #e1e4e8",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "background 0.15s",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#f6f8fa")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "white")
                  }
                  onClick={() => selectRepo(repo)}
                >
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
                      {repo.full_name}
                      {repo.private && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontSize: 12,
                            color: "#666",
                            border: "1px solid #e1e4e8",
                            padding: "2px 8px",
                            borderRadius: 4,
                          }}
                        >
                          Private
                        </span>
                      )}
                    </div>
                    {repo.description && (
                      <div style={{ fontSize: 14, color: "#666" }}>
                        {repo.description}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "#999", marginTop: 4 }}>
                      Updated {new Date(repo.updated_at).toLocaleDateString()}
                    </div>
                  </div>
                  <button
                    style={{
                      padding: "8px 16px",
                      background: "#f6f8fa",
                      border: "1px solid #e1e4e8",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 14,
                      fontWeight: 500,
                    }}
                  >
                    Import
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
