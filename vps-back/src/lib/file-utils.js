const fs = require("fs");
const path = require("path");

const IGNORED_DIRS = new Set([".git", "node_modules", "__pycache__", ".next", "dist", "build", "coverage", ".idea", ".vscode"]);

const SIGNAL_FILES = [
  "package.json",
  "vite.config.js", "vite.config.ts",
  "next.config.js", "next.config.mjs",
  "prisma", // folder
  "requirements.txt", "Pipfile", "pyproject.toml",
  "index.html",
  "manage.py",
  "Dockerfile", "docker-compose.yml"
];

async function getDirectoryTree(dirPath, rootPath, depth = 3) {
  if (depth < 0) return [];

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    const tree = [];
    
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
        const fullPath = path.join(dirPath, entry.name);
        const relPath = path.relative(rootPath, fullPath).replace(/\\/g, "/");
        
        // Let's just scan the direct children for signals
        const subEntries = await fs.promises.readdir(fullPath).catch(() => []);
        const folderSignals = subEntries.filter(f => SIGNAL_FILES.includes(f));
        
        const node = {
          name: entry.name,
          path: relPath,
          type: "folder",
          signals: folderSignals,
          children: depth > 0 ? await getDirectoryTree(fullPath, rootPath, depth - 1) : []
        };
        tree.push(node);
      }
    }
    
    return tree;

  } catch (err) {
    console.error(`Failed to scan ${dirPath}:`, err.message);
    return [];
  }
}

/**
 * Scans the root workspace directory and returns a flat list of potential "root" candidates 
 * (folders containing package.json, requirements.txt, etc.)
 * AND the full directory tree for browsing.
 */
async function scanWorkspaceForRoots(workspacePath) {
    // 1. Get root signals
    const rootEntries = await fs.promises.readdir(workspacePath).catch(() => []);
    const rootSignals = rootEntries.filter(f => SIGNAL_FILES.includes(f));
    
    const rootNode = {
        name: "(root)",
        path: ".",
        type: "folder",
        signals: rootSignals,
        children: await getDirectoryTree(workspacePath, workspacePath, 4)
    };

    return rootNode;
}

module.exports = { scanWorkspaceForRoots };
