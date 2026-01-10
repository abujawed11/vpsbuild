# Docker Server Deployment Setup

This document explains the setup required for deploying servers using Docker containers.

## Prerequisites

1. **Docker and Docker Compose**
   ```bash
   # Install Docker
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh

   # Install Docker Compose
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

2. **Create Docker Network**

   The `web` network is used for communication between containers and nginx:
   ```bash
   docker network create web
   ```

3. **Nginx Configuration**

   Ensure nginx is installed and configured:
   ```bash
   sudo apt install nginx

   # Create directories if they don't exist
   sudo mkdir -p /etc/nginx/sites-available
   sudo mkdir -p /etc/nginx/sites-enabled
   ```

4. **Environment Variables**

   Add these to your `.env` file:
   ```
   # Docker deployments directory
   DEPLOYMENTS_PATH=/srv/deployments

   # Nginx config directories
   NGINX_CONFIG_DIR=/etc/nginx/sites-available
   NGINX_ENABLED_DIR=/etc/nginx/sites-enabled

   # Base domain for subdomains
   BASE_DOMAIN=yourdomain.com
   ```

5. **Create Deployments Directory**
   ```bash
   sudo mkdir -p /srv/deployments
   sudo chown $USER:$USER /srv/deployments
   ```

## How It Works

### For Static Sites (FRONTEND)
- Files are built and copied to `/srv/static-sites/{slug}/current`
- Nginx serves files directly from disk

### For Servers (BACKEND)
1. **Dockerfile Generation**: Automatically generates Node.js or Python Dockerfile
2. **Docker Compose**: Creates compose file with resource limits:
   - Memory: 512MB
   - CPU: 1.0 core
3. **Container Deployment**: Builds and starts container with name = slug
4. **Nginx Proxy**: Auto-configures nginx to proxy `slug.domain.com` → container
5. **Docker Network**: Uses `web` network so nginx can reach containers by name

### Architecture

```
Internet → Nginx (Port 80) → Docker Network "web" → Container (slug:3000)
```

## Resource Limits

Each server container gets:
- **Memory**: 512MB (adjustable in docker-compose-generator.js)
- **CPU**: 1.0 cores (adjustable in docker-compose-generator.js)
- **Restart Policy**: unless-stopped

## Container Management

### View Running Containers
```bash
docker ps
```

### View Container Logs
```bash
docker logs <slug>
```

### Stop Container
```bash
docker stop <slug>
```

### Remove Container
```bash
docker rm <slug>
```

### View All Deployments
```bash
ls /srv/deployments
```

## Nginx Configuration

Each server gets an nginx config at:
- `/etc/nginx/sites-available/{slug}.conf`
- `/etc/nginx/sites-enabled/{slug}.conf` (symlink)

Example config:
```nginx
server {
    listen 80;
    server_name myapp.domain.com;

    location / {
        proxy_pass http://myapp:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # ... other headers
    }
}
```

## Troubleshooting

### Container not starting
```bash
# Check logs
docker logs <slug>

# Check compose file
cat /srv/deployments/<slug>/docker-compose.yml
```

### Nginx errors
```bash
# Test nginx config
sudo nginx -t

# Check nginx logs
sudo tail -f /var/log/nginx/error.log
```

### Network issues
```bash
# Verify web network exists
docker network ls | grep web

# Inspect network
docker network inspect web
```

### Permission issues
```bash
# Give user docker permissions
sudo usermod -aG docker $USER
# Log out and back in

# Fix nginx config permissions
sudo chown -R $USER:$USER /etc/nginx/sites-available
sudo chown -R $USER:$USER /etc/nginx/sites-enabled
```

## Security Notes

1. Containers are isolated with resource limits
2. Only exposed via nginx proxy (no direct port access)
3. Internal Docker network communication only
4. Consider adding SSL/TLS with Let's Encrypt

## Future Improvements

- [ ] Add database containers (Postgres, MySQL)
- [ ] Implement container health checks
- [ ] Add resource usage monitoring
- [ ] Support custom Dockerfiles
- [ ] Add SSL/TLS automation
- [ ] Implement container auto-scaling
