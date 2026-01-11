const express = require("express");
const { getPythonFrameworkPresets } = require("../lib/python-framework-detector");

const router = express.Router();

/**
 * GET /api/framework-presets/python
 * Returns framework presets for Python projects
 */
router.get("/python", (req, res) => {
    try {
        const presets = getPythonFrameworkPresets();
        res.json({ success: true, presets });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch Python framework presets" });
    }
});

/**
 * GET /api/framework-presets/node
 * Returns framework presets for Node.js projects
 */
router.get("/node", (req, res) => {
    try {
        const presets = {
            express: {
                name: 'Express.js',
                defaultCommand: 'node server.js',
                defaultPort: 3000,
                installCommand: 'npm install',
                description: 'Fast, unopinionated web framework'
            },
            nestjs: {
                name: 'NestJS',
                defaultCommand: 'npm run start:prod',
                defaultPort: 3000,
                installCommand: 'npm install',
                description: 'Progressive Node.js framework'
            },
            nextjs: {
                name: 'Next.js',
                defaultCommand: 'npm start',
                defaultPort: 3000,
                installCommand: 'npm install',
                description: 'React framework with SSR'
            }
        };

        res.json({ success: true, presets });
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch Node.js framework presets" });
    }
});

module.exports = router;
