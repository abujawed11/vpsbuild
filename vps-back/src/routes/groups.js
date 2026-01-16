const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const router = express.Router();

function deriveProjectDeploymentStatus(project) {
    if (!project) return "IDLE";
    const latestStatus = project.deployments?.[0]?.status;
    if (!latestStatus) return project.deploymentStatus || "IDLE";
    if (["QUEUED", "CLONING", "BUILDING", "FINALIZING"].includes(latestStatus)) return "BUILDING";
    if (latestStatus === "DEPLOYED") return "DEPLOYED";
    if (latestStatus === "FAILED") return "FAILED";
    return project.deploymentStatus || latestStatus || "IDLE";
}

/**
 * Generate a URL-safe slug from a name
 * e.g., "My App Name" -> "my-app-name"
 */
function generateSlug(name) {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '')  // Remove special chars
        .replace(/\s+/g, '-')           // Replace spaces with hyphens
        .replace(/-+/g, '-')            // Replace multiple hyphens with single
        .substring(0, 50);              // Limit length
}

/**
 * Ensure slug is unique by appending a number if needed
 */
async function ensureUniqueSlug(baseSlug) {
    let slug = baseSlug;
    let counter = 1;

    while (true) {
        const existing = await prisma.projectGroup.findUnique({
            where: { slug }
        });
        if (!existing) return slug;

        slug = `${baseSlug}-${counter}`;
        counter++;

        if (counter > 100) {
            // Fallback: append random string
            slug = `${baseSlug}-${Date.now().toString(36)}`;
            break;
        }
    }
    return slug;
}

// GET /api/groups
router.get("/", authRequired, async (req, res) => {
    try {
        const groups = await prisma.projectGroup.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: "desc" },
            include: {
                projects: {
                    include: {
                         deployments: {
                             orderBy: { createdAt: "desc" },
                             take: 1
                         }
                    }
                },
                database: true  // Include linked database
            }
        });

        // Add component status info (frontend/backend/database)
        const groupsWithStatus = groups.map(g => {
            // Find frontend and backend projects by role
            const frontend = g.projects.find(p => p.role === 'FRONTEND');
            const backend = g.projects.find(p => p.role === 'BACKEND');

            return {
                ...g,
                // Component status flags
                hasFrontend: !!frontend,
                hasBackend: !!backend,
                hasDatabase: !!g.database,
                // Component details
                frontend: frontend ? {
                    id: frontend.id,
                    status: deriveProjectDeploymentStatus(frontend),
                    framework: frontend.framework,
                    latestDeployment: frontend.deployments[0] || null
                } : null,
                backend: backend ? {
                    id: backend.id,
                    status: deriveProjectDeploymentStatus(backend),
                    framework: backend.framework,
                    latestDeployment: backend.deployments[0] || null
                } : null,
                databaseInfo: g.database ? {
                    id: g.database.id,
                    type: g.database.type,
                    status: g.database.status
                } : null,
                // Legacy: keep projects array for backward compatibility
                projects: g.projects.map(p => ({
                    ...p,
                    latestDeployment: p.deployments[0] || null,
                    hasDeployedVersion: p.deployments.some(d => d.status === "DEPLOYED")
                }))
            };
        });

        res.json({ groups: groupsWithStatus });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch groups" });
    }
});

// POST /api/groups
router.post("/", authRequired, async (req, res) => {
    const { name, apiPathPrefix = "/api" } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    try {
        // Generate unique slug from name
        const baseSlug = generateSlug(name);
        if (!baseSlug) {
            return res.status(400).json({ error: "Invalid name - must contain letters or numbers" });
        }
        const slug = await ensureUniqueSlug(baseSlug);

        const group = await prisma.projectGroup.create({
            data: {
                userId: req.user.id,
                name,
                slug,
                apiPathPrefix
            }
        });

        // Create uploads and media directories for this project
        const baseDomain = process.env.BASE_DOMAIN || "93.127.199.118.sslip.io";
        const publicBaseUrl = process.env.PUBLIC_BASE_URL || `http://${baseDomain}`;
        const urlMatch = publicBaseUrl.match(/^(https?):\/\/([^:\/]+)(:\d+)?/);
        const protocol = urlMatch ? urlMatch[1] : "http";
        const domain = urlMatch ? urlMatch[2] : baseDomain;
        const port = urlMatch && urlMatch[3] ? urlMatch[3] : "";
        const groupUrl = `${protocol}://${group.slug}.${domain}${port}`;
        const staticSitesPath = process.env.STATIC_SITES_PATH || '/srv/static-sites';
        const projectDir = path.join(staticSitesPath, slug);

        try {
            await fs.mkdir(path.join(projectDir, 'uploads'), { recursive: true });
            await fs.mkdir(path.join(projectDir, 'media'), { recursive: true });
        } catch (dirErr) {
            console.error('Failed to create uploads/media dirs:', dirErr);
            // Non-fatal - continue anyway
        }

        res.json({
            success: true,
            group,
            url: `https://${slug}.${baseDomain}`
        });
    } catch (err) {
        if (err.code === 'P2002') {
             return res.status(400).json({ error: "Group name already exists" });
        }
        console.error(err);
        res.status(500).json({ error: "Failed to create group" });
    }
});

// PATCH /api/groups/:id - Update group settings
router.patch("/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    const { name, apiPathPrefix } = req.body;

    try {
        // Verify ownership
        const group = await prisma.projectGroup.findUnique({ where: { id } });
        if (!group || group.userId !== req.user.id) {
            return res.status(404).json({ error: "Group not found" });
        }

        const updateData = {};
        if (name !== undefined) updateData.name = name;
        if (apiPathPrefix !== undefined) updateData.apiPathPrefix = apiPathPrefix;

        const updated = await prisma.projectGroup.update({
            where: { id },
            data: updateData
        });

        res.json({ success: true, group: updated });
    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ error: "Group name already exists" });
        }
        console.error(err);
        res.status(500).json({ error: "Failed to update group" });
    }
});

// GET /api/groups/:id - Get single group with full details
router.get("/:id", authRequired, async (req, res) => {
    const { id } = req.params;

    try {
        const group = await prisma.projectGroup.findUnique({
            where: { id },
            include: {
                projects: {
                    include: {
                        deployments: {
                            orderBy: { createdAt: "desc" },
                            take: 5
                        },
                        envVars: true
                    }
                },
                database: true
            }
        });

        if (!group || group.userId !== req.user.id) {
            return res.status(404).json({ error: "Group not found" });
        }

        // Find frontend and backend
        const frontend = group.projects.find(p => p.role === 'FRONTEND');
        const backend = group.projects.find(p => p.role === 'BACKEND');

        const baseDomain = process.env.BASE_DOMAIN || '93.127.199.118.sslip.io';

        const formatProject = (p) => {
            if (!p) return null;
            return {
                ...p,
                deploymentStatus: deriveProjectDeploymentStatus(p),
                latestDeployment: p.deployments?.[0] || null,
                hasDeployedVersion: Array.isArray(p.deployments) ? p.deployments.some(d => d.status === "DEPLOYED") : false
            };
        };

        res.json({
            ...group,
            url: groupUrl,
            hasFrontend: !!frontend,
            hasBackend: !!backend,
            hasDatabase: !!group.database,
            frontend: formatProject(frontend),
            backend: formatProject(backend),
            databaseInfo: group.database ? {
                id: group.database.id,
                type: group.database.type,
                status: group.database.status
            } : null
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch group" });
    }
});

// DELETE /api/groups/:id
router.delete("/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        // Verify ownership
        const group = await prisma.projectGroup.findUnique({
            where: { id },
            include: { projects: true, database: true }
        });
        if (!group || group.userId !== req.user.id) {
            return res.status(404).json({ error: "Group not found" });
        }

        // AWS-style: Prevent deletion if project contains components
        if (group.projects && group.projects.length > 0) {
            return res.status(400).json({
                error: "Cannot delete project with components",
                message: `This project contains ${group.projects.length} component${group.projects.length > 1 ? 's' : ''}. Please delete all components (frontend/backend) first.`
            });
        }

        if (group.database) {
            return res.status(400).json({
                error: "Cannot delete project with database",
                message: "Please delete the database first."
            });
        }

        // Cleanup uploads/media directories for this project group
        const staticSitesPath = process.env.STATIC_SITES_PATH || "/srv/static-sites";
        const projectDir = path.join(staticSitesPath, group.slug);
        if (fsSync.existsSync(projectDir)) {
            await fs.rm(projectDir, { recursive: true, force: true }).catch(e => console.error(e));
        }

        // Cleanup any remaining project-level resources (legacy)
        const projects = await prisma.project.findMany({ where: { groupId: id } });

        for (const p of projects) {
             // Cleanup static site
             if (p.slug) {
                const staticSitePath = path.join(staticSitesPath, p.slug);
                if (fsSync.existsSync(staticSitePath)) {
                    await fs.rm(staticSitePath, { recursive: true, force: true }).catch(e => console.error(e));
                }
             }
             // Cleanup workspace
             if (p.workspacePath && fsSync.existsSync(p.workspacePath)) {
                 await fs.rm(p.workspacePath, { recursive: true, force: true }).catch(e => console.error(e));
             }
        }

        await prisma.projectGroup.delete({ where: { id } });
        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete group" });
    }
});

module.exports = router;
