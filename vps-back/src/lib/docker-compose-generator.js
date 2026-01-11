const yaml = require('js-yaml');
const fs = require('fs').promises;
const path = require('path');

/**
 * Generate docker-compose.yml for a server deployment
 * @param {Object} project - Project details
 * @param {Array} envVars - Environment variables
 * @returns {string} - YAML content
 */
function generateDockerCompose(project, envVars = []) {
    const {
        slug,
        workspacePath,
        rootDir = "",
        port = 3000,
        startCommand,
        runtime
    } = project;

    const normalizeWorkspaceRelPath = (rel) => {
        if (rel === undefined || rel === null) return "";
        const raw = String(rel).trim();
        if (!raw || raw === "/" || raw === "." || raw === "./") return "";
        const stripped = raw.replace(/^[/\\]+/, "");
        const normalized = path.normalize(stripped);
        if (!normalized || normalized === "." || normalized === path.sep) return "";
        if (path.isAbsolute(normalized) || normalized.startsWith("..")) return "";
        return normalized;
    };

    // Build the context path (where Dockerfile is located)
    const safeRootDir = normalizeWorkspaceRelPath(rootDir);
    const buildContext = safeRootDir ? path.join(workspacePath, safeRootDir) : workspacePath;

    // Convert env vars array to object
    const environment = {};
    envVars.forEach(ev => {
        environment[ev.key] = ev.value;
    });

    // Add PORT to environment
    environment.PORT = port;
    environment.NODE_ENV = environment.NODE_ENV || 'production';

    const composeConfig = {
        version: '3.8',
        services: {
            app: {
                build: {
                    context: buildContext,
                    dockerfile: 'Dockerfile'
                },
                container_name: slug,
                mem_limit: '512m',
                cpus: 1.0,
                networks: ['web'],
                restart: 'unless-stopped',
                environment,
                labels: {
                    'com.vpsbuilds.project': slug,
                    'com.vpsbuilds.type': 'server'
                }
            }
        },
        networks: {
            web: {
                external: true
            }
        }
    };

    return yaml.dump(composeConfig, { indent: 2 });
}

/**
 * Write docker-compose.yml file to deployments directory
 * @param {string} slug - Project slug
 * @param {string} composeContent - YAML content
 * @returns {string} - Path to the docker-compose.yml file
 */
async function writeDockerCompose(slug, composeContent) {
    const deploymentsRoot = process.env.DEPLOYMENTS_PATH || path.join(__dirname, '../../../deployments');
    const projectDeployPath = path.join(deploymentsRoot, slug);

    // Create directory if it doesn't exist
    await fs.mkdir(projectDeployPath, { recursive: true });

    const composePath = path.join(projectDeployPath, 'docker-compose.yml');
    await fs.writeFile(composePath, composeContent, 'utf8');

    return composePath;
}

module.exports = {
    generateDockerCompose,
    writeDockerCompose
};
