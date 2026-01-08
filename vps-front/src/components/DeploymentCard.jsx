export default function DeploymentCard({ deployment, isActive }) {
  const getStatusColor = (status) => {
    switch (status) {
      case "READY":
        return "#2da44e";
      case "ERROR":
      case "CANCELLED":
        return "#cf1322";
      case "QUEUED":
      case "CLONING":
      case "ANALYZING":
      case "BUILDING":
      case "DEPLOYING":
        return "#0969da";
      default:
        return "#666";
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case "QUEUED":
        return "Queued";
      case "CLONING":
        return "Cloning repository...";
      case "ANALYZING":
        return "Analyzing project structure...";
      case "BUILDING":
        return "Building Docker images...";
      case "DEPLOYING":
        return "Deploying containers...";
      case "READY":
        return "Live";
      case "ERROR":
        return "Failed";
      case "CANCELLED":
        return "Cancelled";
      default:
        return status;
    }
  };

  // Check if deployment is truly in progress (not stuck)
  const isInProgress = (() => {
    if (
      deployment.status === "READY" ||
      deployment.status === "ERROR" ||
      deployment.status === "CANCELLED"
    ) {
      return false;
    }

    // If deployment is older than 2 minutes and still "in progress", it's likely stuck
    const createdAt = new Date(deployment.createdAt);
    const now = new Date();
    const ageMinutes = (now - createdAt) / 60000;

    if (ageMinutes > 2) {
      return false; // Don't show spinner for stuck deployments
    }

    return true;
  })();

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div
      style={{
        border: `1px solid ${isActive ? "#0969da" : "#e1e4e8"}`,
        borderRadius: 6,
        padding: 16,
        background: isActive ? "#f0f6ff" : "white",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
        <div style={{ flex: 1 }}>
          {/* Status */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: getStatusColor(deployment.status),
              }}
            />
            <span style={{ fontSize: 14, fontWeight: 500, color: getStatusColor(deployment.status) }}>
              {getStatusText(deployment.status)}
            </span>
            {isInProgress && (
              <span
                style={{
                  display: "inline-block",
                  width: 16,
                  height: 16,
                  border: "2px solid #0969da",
                  borderTopColor: "transparent",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
            )}
          </div>

          {/* Commit Info */}
          <div style={{ fontSize: 14, color: "#24292e", marginBottom: 4 }}>
            <strong>{deployment.branch}</strong>
            {deployment.commitHash && (
              <span style={{ color: "#666", marginLeft: 8 }}>
                {deployment.commitHash.substring(0, 7)}
              </span>
            )}
          </div>

          {deployment.commitMessage && (
            <div
              style={{
                fontSize: 13,
                color: "#666",
                marginBottom: 8,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {deployment.commitMessage.split("\n")[0]}
            </div>
          )}

          {/* Timing Info */}
          <div style={{ fontSize: 12, color: "#999" }}>
            {deployment.deployedAt
              ? `Deployed ${formatDate(deployment.deployedAt)}`
              : `Started ${formatDate(deployment.createdAt)}`}
            {deployment.buildDuration && ` • ${deployment.buildDuration}s`}
          </div>

          {/* Error Message */}
          {deployment.status === "ERROR" && deployment.errorMessage && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                background: "#fff1f0",
                border: "1px solid #ffa39e",
                borderRadius: 4,
                fontSize: 12,
                color: "#cf1322",
              }}
            >
              {deployment.errorMessage}
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8 }}>
          {deployment.url && deployment.status === "READY" && (
            <a
              href={deployment.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: "6px 12px",
                background: "#f6f8fa",
                border: "1px solid #e1e4e8",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 500,
                textDecoration: "none",
                color: "#24292e",
              }}
            >
              Visit →
            </a>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
