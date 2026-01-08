import { useState, useEffect } from "react";
import { getProject, deployProject, pollDeploymentStatus } from "../lib/api-v2";
import DeploymentCard from "./DeploymentCard";

export default function ProjectView({ projectId, onBack }) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deploying, setDeploying] = useState(false);
  const [currentDeployment, setCurrentDeployment] = useState(null);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  async function loadProject() {
    setLoading(true);
    setError("");
    try {
      const data = await getProject(projectId);
      setProject(data.project);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeploy() {
    setDeploying(true);
    setError("");

    try {
      const result = await deployProject(projectId);
      const deploymentId = result.deployment.id;

      // Poll for deployment status
      await pollDeploymentStatus(deploymentId, (deployment) => {
        setCurrentDeployment(deployment);
      });

      // Reload project to get updated deployments
      await loadProject();
      setDeploying(false);
    } catch (e) {
      setError("Deployment failed: " + e.message);
      setDeploying(false);
    }
  }

  if (loading) {
    return (
      <div
        style={{
          background: "white",
          borderRadius: 8,
          padding: 48,
          textAlign: "center",
        }}
      >
        <p style={{ color: "#666" }}>Loading project...</p>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div
        style={{
          background: "#fff1f0",
          border: "1px solid #ffa39e",
          borderRadius: 8,
          padding: 24,
          color: "#cf1322",
        }}
      >
        {error}
      </div>
    );
  }

  const latestDeployment = project.deployments?.[0];
  const isDeployed = latestDeployment?.status === "READY";

  return (
    <div>
      {/* Project Header */}
      <div
        style={{
          background: "white",
          borderRadius: 8,
          padding: 24,
          marginBottom: 24,
          border: "1px solid #e1e4e8",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 28, fontWeight: 600 }}>
              {project.name}
            </h2>
            <p style={{ margin: "8px 0 0 0", color: "#666", fontSize: 14 }}>
              {project.repoFullName}
            </p>
          </div>

          {isDeployed && (
            <a
              href={latestDeployment.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "10px 20px",
                background: "#2da44e",
                color: "white",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 500,
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Visit Site →
            </a>
          )}
        </div>

        <div
          style={{
            marginTop: 24,
            padding: 16,
            background: "#f6f8fa",
            borderRadius: 6,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 16,
          }}
        >
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
              Project Type
            </div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {project.projectType === "MONOREPO" && "Monorepo (Frontend + Backend)"}
              {project.projectType === "FRONTEND_ONLY" && "Frontend Only"}
              {project.projectType === "BACKEND_ONLY" && "Backend Only"}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
              Production Branch
            </div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>
              {project.productionBranch}
            </div>
          </div>

          {project.frontendFramework && (
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                Frontend Framework
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {project.frontendFramework}
              </div>
            </div>
          )}

          {project.backendRuntime && (
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                Backend Runtime
              </div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {project.backendRuntime}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Deployment Status / CTA */}
      {currentDeployment ? (
        <DeploymentCard deployment={currentDeployment} isActive={true} />
      ) : !isDeployed ? (
        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 32,
            marginBottom: 24,
            border: "1px solid #e1e4e8",
            textAlign: "center",
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 20 }}>Ready to deploy!</h3>
          <p style={{ color: "#666", marginBottom: 24 }}>
            We'll automatically detect your project structure and deploy it with
            one click.
          </p>
          <button
            onClick={handleDeploy}
            disabled={deploying}
            style={{
              padding: "12px 32px",
              background: "#2da44e",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: deploying ? "not-allowed" : "pointer",
              fontSize: 16,
              fontWeight: 500,
              opacity: deploying ? 0.5 : 1,
            }}
          >
            {deploying ? "Deploying..." : "Deploy Now"}
          </button>
        </div>
      ) : (
        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            marginBottom: 24,
            border: "1px solid #e1e4e8",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                Production Deployment
              </h3>
              <p style={{ margin: "4px 0 0 0", color: "#666", fontSize: 14 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#2da44e",
                    marginRight: 8,
                  }}
                />
                Live
              </p>
            </div>
            <button
              onClick={handleDeploy}
              disabled={deploying}
              style={{
                padding: "10px 20px",
                background: "#f6f8fa",
                color: "#24292e",
                border: "1px solid #e1e4e8",
                borderRadius: 6,
                cursor: deploying ? "not-allowed" : "pointer",
                fontSize: 14,
                fontWeight: 500,
                opacity: deploying ? 0.5 : 1,
              }}
            >
              {deploying ? "Deploying..." : "Redeploy"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            background: "#fff1f0",
            border: "1px solid #ffa39e",
            borderRadius: 8,
            padding: 16,
            marginBottom: 24,
            color: "#cf1322",
          }}
        >
          {error}
        </div>
      )}

      {/* Recent Deployments */}
      {project.deployments && project.deployments.length > 0 && (
        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            border: "1px solid #e1e4e8",
          }}
        >
          <h3 style={{ marginTop: 0, fontSize: 18, fontWeight: 600 }}>
            Recent Deployments
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {project.deployments.map((deployment) => (
              <DeploymentCard
                key={deployment.id}
                deployment={deployment}
                isActive={false}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
