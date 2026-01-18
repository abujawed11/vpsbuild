const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const multer = require("multer");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            const { groupId } = req.params;
            const folder = req.query.folder || 'uploads';

            // Get project group to find slug
            const group = await prisma.projectGroup.findUnique({
                where: { id: groupId },
                include: { projects: true }
            });

            if (!group) {
                return cb(new Error('Project not found'));
            }

            // Get allowed folders from projects
            const allowedFolders = ['uploads', 'media'];
            group.projects.forEach(p => {
                if (p.staticFolder) allowedFolders.push(p.staticFolder);
            });

            // Validate folder
            const isAllowed = allowedFolders.some(root => 
                (folder === root) || (folder.startsWith(root + '/') && !folder.includes('..'))
            );

            if (!isAllowed) {
                return cb(new Error(`Invalid folder. Must start with one of: ${allowedFolders.join(', ')}`));
            }

            const staticSitesPath = process.env.STATIC_SITES_PATH || '/srv/static-sites';
            const uploadPath = path.join(staticSitesPath, group.slug, folder);

            // Ensure directory exists
            await fs.mkdir(uploadPath, { recursive: true });

            cb(null, uploadPath);
        } catch (err) {
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        // Sanitize filename and preserve extension
        const ext = path.extname(file.originalname);
        const basename = path.basename(file.originalname, ext)
            .replace(/[^a-zA-Z0-9_-]/g, '_')
            .substring(0, 100);
        const uniqueSuffix = Date.now().toString(36);
        cb(null, `${basename}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB max
        files: 10 // Max 10 files at once
    },
    fileFilter: (req, file, cb) => {
        // Allow common file types
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
            'video/mp4', 'video/webm', 'video/ogg',
            'audio/mpeg', 'audio/wav', 'audio/ogg',
            'application/pdf',
            'text/plain', 'text/csv',
            'application/json',
            'application/zip'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed`));
        }
    }
});

/**
 * Verify user owns the project group
 */
async function verifyGroupOwnership(groupId, userId) {
    const group = await prisma.projectGroup.findUnique({
        where: { id: groupId },
        include: { projects: true }
    });

    if (!group || group.userId !== userId) {
        return null;
    }
    return group;
}

/**
 * Get file stats with human-readable size
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// POST /api/files/:groupId/upload - Upload files
router.post("/:groupId/upload", authRequired, upload.array('files', 10), async (req, res) => {
    const { groupId } = req.params;
    const folder = req.query.folder || 'uploads';

    try {
        const group = await verifyGroupOwnership(groupId, req.user.id);
        if (!group) {
            return res.status(404).json({ error: "Project not found" });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: "No files uploaded" });
        }

        const baseDomain = process.env.BASE_DOMAIN || '93.127.199.118.sslip.io';
        const uploadedFiles = req.files.map(file => ({
            filename: file.filename,
            originalName: file.originalname,
            size: formatFileSize(file.size),
            sizeBytes: file.size,
            mimetype: file.mimetype,
            url: `https://${group.slug}.${baseDomain}/${folder}/${file.filename}`
        }));

        res.json({
            success: true,
            files: uploadedFiles
        });
    } catch (err) {
        console.error('Upload error:', err);
        res.status(500).json({ error: err.message || "Failed to upload files" });
    }
});

// GET /api/files/:groupId - List files in folder
router.get("/:groupId", authRequired, async (req, res) => {
    const { groupId } = req.params;
    const folder = req.query.folder || 'uploads';

    try {
        const group = await verifyGroupOwnership(groupId, req.user.id);
        if (!group) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Get allowed folders from projects
        const allowedFolders = ['uploads', 'media'];
        if (group.projects) {
             group.projects.forEach(p => {
                if (p.staticFolder) allowedFolders.push(p.staticFolder);
            });
        }

        // Validate folder
        const isAllowed = allowedFolders.some(root => 
            (folder === root) || (folder.startsWith(root + '/') && !folder.includes('..'))
        );

        if (!isAllowed) {
            return res.status(400).json({ error: `Invalid folder. Must start with one of: ${allowedFolders.join(', ')}` });
        }
        const folderPath = path.join(staticSitesPath, group.slug, folder);

        // Check if folder exists
        if (!fsSync.existsSync(folderPath)) {
            return res.json({ files: [], folder });
        }

        const entries = await fs.readdir(folderPath, { withFileTypes: true });
        const baseDomain = process.env.BASE_DOMAIN || '93.127.199.118.sslip.io';

        const files = await Promise.all(
            entries
                .filter(entry => entry.isFile())
                .map(async (entry) => {
                    const filePath = path.join(folderPath, entry.name);
                    const stats = await fs.stat(filePath);

                    // Determine file type for UI icon
                    const ext = path.extname(entry.name).toLowerCase();
                    let type = 'file';
                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'].includes(ext)) {
                        type = 'image';
                    } else if (['.mp4', '.webm', '.ogg', '.mov'].includes(ext)) {
                        type = 'video';
                    } else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(ext)) {
                        type = 'audio';
                    } else if (['.pdf'].includes(ext)) {
                        type = 'pdf';
                    }

                    return {
                        filename: entry.name,
                        size: formatFileSize(stats.size),
                        sizeBytes: stats.size,
                        type,
                        modifiedAt: stats.mtime,
                        url: `https://${group.slug}.${baseDomain}/${folder}/${entry.name}`
                    };
                })
        );

        // Sort by modified date (newest first)
        files.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

        res.json({
            folder,
            files,
            count: files.length,
            projectUrl: `https://${group.slug}.${baseDomain}`
        });
    } catch (err) {
        console.error('List files error:', err);
        res.status(500).json({ error: "Failed to list files" });
    }
});

// DELETE /api/files/:groupId/:filename - Delete a file
router.delete("/:groupId/:filename", authRequired, async (req, res) => {
    const { groupId, filename } = req.params;
    const folder = req.query.folder || 'uploads';

    try {
        const group = await verifyGroupOwnership(groupId, req.user.id);
        if (!group) {
            return res.status(404).json({ error: "Project not found" });
        }

        // Get allowed folders from projects
        const allowedFolders = ['uploads', 'media'];
        if (group.projects) {
             group.projects.forEach(p => {
                if (p.staticFolder) allowedFolders.push(p.staticFolder);
            });
        }

        // Validate folder
        const isAllowed = allowedFolders.some(root => 
            (folder === root) || (folder.startsWith(root + '/') && !folder.includes('..'))
        );

        if (!isAllowed) {
            return res.status(400).json({ error: `Invalid folder. Must start with one of: ${allowedFolders.join(', ')}` });
        }

        // Sanitize filename to prevent directory traversal
        const sanitizedFilename = path.basename(filename);
        if (sanitizedFilename !== filename || filename.includes('..')) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        const staticSitesPath = process.env.STATIC_SITES_PATH || '/srv/static-sites';
        const filePath = path.join(staticSitesPath, group.slug, folder, sanitizedFilename);

        // Check if file exists
        if (!fsSync.existsSync(filePath)) {
            return res.status(404).json({ error: "File not found" });
        }

        await fs.unlink(filePath);

        res.json({
            success: true,
            message: `File ${sanitizedFilename} deleted`
        });
    } catch (err) {
        console.error('Delete file error:', err);
        res.status(500).json({ error: "Failed to delete file" });
    }
});

// Error handling middleware for multer
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: 'Too many files. Maximum is 10 files at once.' });
        }
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

module.exports = router;
