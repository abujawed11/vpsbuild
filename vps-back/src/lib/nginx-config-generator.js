const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

/**
 * Generate nginx config for path-based routing on a single subdomain
 * Supports: frontend, backend, uploads, media
 *
 * @param {Object} projectGroup - The project group with its components
 * @param {string} projectGroup.slug - Subdomain identifier
 * @param {string} projectGroup.apiPathPrefix - API route prefix (default: /api)
 * @param {Object} projectGroup.frontend - Frontend project (optional)
 * @param {Object} projectGroup.backend - Backend project (optional)
 */
function generateNginxServerConfig(projectGroup) {
    const {
        slug,
        apiPathPrefix = '/api',
        frontend,
        backend
    } = projectGroup;

    const baseDomain = process.env.BASE_DOMAIN || '93.127.199.118.sslip.io';
    const staticSitesPath = process.env.STATIC_SITES_PATH || '/srv/static-sites';

    // Normalize API prefix (ensure it starts with / and doesn't end with /)
    const normalizedApiPrefix = apiPathPrefix.startsWith('/')
        ? apiPathPrefix.replace(/\/+$/, '')
        : `/${apiPathPrefix}`.replace(/\/+$/, '');

    // Build location blocks based on what's deployed
    let locationBlocks = '';

    // Backend persistent storage (user-configured static folder)
    // Proxy to backend container which serves files from its mounted volume
    if (backend && backend.staticFolder) {
        const backendPort = backend.port || 3000;
        const backendContainer = `${slug}-backend`;
        const staticFolder = backend.staticFolder;

        locationBlocks += `
    # User uploads/media - proxied to backend container's persistent volume
    location /${staticFolder}/ {
        set $backend "${backendContainer}";
        proxy_pass http://$backend:${backendPort}/${staticFolder}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Cache static files
        expires 30d;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options "nosniff";
    }
`;
    } else {
        // Fallback: serve from static sites path (legacy behavior)
        locationBlocks += `
    # VPSBuild-managed uploads - served directly by Nginx
    location /uploads/ {
        alias ${staticSitesPath}/${slug}/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options "nosniff";
    }

    # VPSBuild-managed media - served directly by Nginx
    location /media/ {
        alias ${staticSitesPath}/${slug}/media/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        add_header X-Content-Type-Options "nosniff";
    }
`;
    }

    // Backend API routes (if backend is deployed)
    if (backend) {
        const backendPort = backend.port || 3000;
        const backendContainer = `${slug}-backend`;

        locationBlocks += `
    # Backend API routes → Backend container
    location ${normalizedApiPrefix}/ {
        set $backend "${backendContainer}";
        proxy_pass http://$backend:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
        proxy_read_timeout 60s;
        proxy_connect_timeout 10s;
    }
`;
    }

    // Frontend routes (if frontend is deployed)
    if (frontend) {
        const frontendRoot = `${staticSitesPath}/${slug}/current`;

        locationBlocks += `
    # Frontend SPA → Frontend container
    root ${frontendRoot};
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
`;
    } else if (backend && !frontend) {
        // Only backend deployed - route / to backend as well
        const backendPort = backend.port || 3000;
        const backendContainer = `${slug}-backend`;

        locationBlocks += `
    # No frontend - route all to backend
    location / {
        set $backend "${backendContainer}";
        proxy_pass http://$backend:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }
`;
    } else {
        // Nothing deployed yet - return a placeholder page
        locationBlocks += `
    # No components deployed yet
    location / {
        default_type text/html;
        return 200 '<html><body><h1>Project: ${slug}</h1><p>No frontend or backend deployed yet.</p></body></html>';
    }
`;
    }

    return `# Path-based routing for ${slug}.${baseDomain}
# Generated by VPSBuild
server {
    listen 80;
    server_name ${slug}.${baseDomain};

    # Docker DNS resolver (delays upstream resolution until request time)
    resolver 127.0.0.11 ipv6=off valid=10s;

    # Client upload size limit
    client_max_body_size 50m;
${locationBlocks}
}
`;
}

/**
 * Legacy: Generate nginx config for a single project (backward compatibility)
 */
function generateNginxServerConfigLegacy(project) {
    const { slug, port = 3000 } = project;
    const baseDomain = process.env.BASE_DOMAIN || '93.127.199.118.sslip.io';

    return `# Subdomain routing for ${slug} (legacy)
server {
    listen 80;
    server_name ${slug}.${baseDomain};

    # Docker DNS resolver (delays upstream resolution until request time)
    resolver 127.0.0.11 ipv6=off valid=10s;
    set $upstream "${slug}";

    location / {
        proxy_pass http://$upstream:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_redirect off;
    }
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
    const isGroupConfig =
        Object.prototype.hasOwnProperty.call(project, "apiPathPrefix") ||
        Object.prototype.hasOwnProperty.call(project, "frontend") ||
        Object.prototype.hasOwnProperty.call(project, "backend");
    const configContent = isGroupConfig
        ? generateNginxServerConfig(project)
        : generateNginxServerConfigLegacy(project);

    await fs.writeFile(configPath, configContent, 'utf8');

    return configPath;
}

/**
 * Test and reload nginx with rollback on failure
 */
async function reloadNginx(project) {
    const nginxContainer = process.env.NGINX_CONTAINER || 'vpsbuilds-nginx-1';

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
    const nginxContainer = process.env.NGINX_CONTAINER || 'vpsbuilds-nginx-1';

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
    generateNginxServerConfigLegacy,  // For backward compatibility with existing projects
    writeNginxConfig,
    reloadNginx,
    healthCheckFromNginx,
    removeNginxConfig
};
