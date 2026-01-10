const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Generate nginx config for path-based routing: /apps/<slug>/
 */
function generateNginxServerConfig(project) {
    const { slug, port = 3000 } = project;

    return `# Path-based routing for ${slug}
location /apps/${slug}/ {
    proxy_pass http://${slug}:${port}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /apps/${slug};
    proxy_cache_bypass $http_upgrade;

    # Rewrite for clean paths
    proxy_redirect off;
}
`;
}

/**
 * Write nginx config file
 */
async function writeNginxConfig(project) {
    const { slug } = project;
    // Use absolute path to shared volume
    const nginxProjectsDir = '/nginx/projects';

    // Create directory if it doesn't exist
    await fs.mkdir(nginxProjectsDir, { recursive: true });

    const configPath = path.join(nginxProjectsDir, `${slug}.conf`);
    const configContent = generateNginxServerConfig(project);

    await fs.writeFile(configPath, configContent, 'utf8');

    return configPath;
}

/**
 * Test and reload nginx with rollback on failure
 */
async function reloadNginx(project) {
    const nginxContainer = 'vpsbuilds-nginx-1';

    try {
        // Test config
        await execPromise(`docker exec ${nginxContainer} nginx -t`);

        // Reload if test passes
        await execPromise(`docker exec ${nginxContainer} nginx -s reload`);

        return { success: true };
    } catch (err) {
        // Rollback: delete the config file
        const configPath = path.join('/nginx/projects', `${project.slug}.conf`);
        await fs.unlink(configPath).catch(() => {});

        throw new Error(`Nginx config invalid: ${err.message}`);
    }
}

/**
 * Health check from nginx container
 */
async function healthCheckFromNginx(containerName, port = 3000) {
    const nginxContainer = 'vpsbuilds-nginx-1';

    try {
        const cmd = `docker exec ${nginxContainer} sh -c "command -v curl >/dev/null || apk add --no-cache curl >/dev/null 2>&1; curl -f -s -o /dev/null -w '%{http_code}' http://${containerName}:${port}/ || echo fail"`;
        const { stdout } = await execPromise(cmd, { timeout: 10000 });

        const response = stdout.trim();
        if (response === 'fail' || response === '') {
            return { reachable: false, error: 'Container not reachable from nginx' };
        }

        return { reachable: true, statusCode: response };
    } catch (err) {
        return { reachable: false, error: err.message };
    }
}

/**
 * Remove nginx config for a project
 */
async function removeNginxConfig(slug) {
    const configPath = path.join('/nginx/projects', `${slug}.conf`);

    try {
        await fs.unlink(configPath).catch(() => {});
        await reloadNginx({ slug: 'cleanup' }).catch(() => {});
    } catch (err) {
        console.error(`Failed to remove nginx config: ${err.message}`);
    }
}

module.exports = {
    generateNginxServerConfig,
    writeNginxConfig,
    reloadNginx,
    healthCheckFromNginx,
    removeNginxConfig
};
