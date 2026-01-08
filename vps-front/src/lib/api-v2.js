import { getToken } from "./auth";

const BASE_URL = "http://localhost:5000";

/**
 * V2 API Client for simplified deployment flow
 */

export async function importRepository(repoFullName, branch) {
  const token = getToken();
  const response = await fetch(`${BASE_URL}/api/v2/projects/import`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ repoFullName, branch }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to import repository");
  }

  return response.json();
}

export async function getProject(projectId) {
  const token = getToken();
  const response = await fetch(`${BASE_URL}/api/v2/projects/${projectId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to get project");
  }

  return response.json();
}

export async function deployProject(projectId, branch = null, deploymentType = "PRODUCTION") {
  const token = getToken();
  const response = await fetch(`${BASE_URL}/api/v2/projects/${projectId}/deploy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ branch, deploymentType }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to deploy project");
  }

  return response.json();
}

export async function getDeployment(deploymentId) {
  const token = getToken();
  const response = await fetch(
    `${BASE_URL}/api/v2/projects/deployments/${deploymentId}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to get deployment");
  }

  return response.json();
}

export async function changeBranch(projectId, branch) {
  const token = getToken();
  const response = await fetch(
    `${BASE_URL}/api/v2/projects/${projectId}/change-branch`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ branch }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to change branch");
  }

  return response.json();
}

/**
 * Poll deployment status until it's ready or failed
 */
export async function pollDeploymentStatus(deploymentId, onUpdate, maxAttempts = 120) {
  let attempts = 0;

  while (attempts < maxAttempts) {
    try {
      const { deployment } = await getDeployment(deploymentId);

      if (onUpdate) {
        onUpdate(deployment);
      }

      if (deployment.status === "READY" || deployment.status === "ERROR") {
        return deployment;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    } catch (error) {
      console.error("Error polling deployment:", error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      attempts++;
    }
  }

  throw new Error("Deployment timeout");
}
