const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");

const router = express.Router();

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
                }
            }
        });
        
        // Add status info to projects inside groups
        const groupsWithStatus = groups.map(g => ({
            ...g,
            projects: g.projects.map(p => ({
                ...p,
                latestDeployment: p.deployments[0] || null,
                hasDeployedVersion: p.deployments.some(d => d.status === "DEPLOYED")
            }))
        }));

        res.json({ groups: groupsWithStatus });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch groups" });
    }
});

// POST /api/groups
router.post("/", authRequired, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    try {
        const group = await prisma.projectGroup.create({
            data: {
                userId: req.user.id,
                name
            }
        });
        res.json({ success: true, group });
    } catch (err) {
        if (err.code === 'P2002') {
             return res.status(400).json({ error: "Group name already exists" });
        }
        console.error(err);
        res.status(500).json({ error: "Failed to create group" });
    }
});

// DELETE /api/groups/:id
router.delete("/:id", authRequired, async (req, res) => {
    const { id } = req.params;
    try {
        // Verify ownership
        const group = await prisma.projectGroup.findUnique({
            where: { id },
            include: { projects: true }
        });
        if (!group || group.userId !== req.user.id) {
            return res.status(404).json({ error: "Group not found" });
        }

        // AWS-style: Prevent deletion if project contains sites
        if (group.projects && group.projects.length > 0) {
            return res.status(400).json({
                error: "Cannot delete project with sites",
                message: `This project contains ${group.projects.length} site${group.projects.length > 1 ? 's' : ''}. Please delete all sites first.`
            });
        }

        // Project is empty, safe to delete
        const projects = await prisma.project.findMany({ where: { groupId: id } });
        
        for (const p of projects) {
             // Cleanup static site
             if (p.slug) {
                const staticSitePath = path.join(
                    process.env.STATIC_SITES_PATH || "/srv/static-sites",
                    p.slug
                );
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
