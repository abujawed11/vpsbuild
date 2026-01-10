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

async function getDirectoryChildren(workspacePath, relativePath = "") {
  // Security check: ensure relativePath doesn't try to go up
  const safeRelative = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const fullPath = path.join(workspacePath, safeRelative);

  if (!fullPath.startsWith(workspacePath)) {
      throw new Error("Invalid path");
  }

  try {
      const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
      const children = [];

      for (const entry of entries) {
          if (IGNORED_DIRS.has(entry.name)) continue;

          if (entry.isDirectory()) {
              const childRelPath = path.join(safeRelative, entry.name).replace(/\\/g, "/");

              // Check for signals in this folder (shallow scan of its children)
              const subPath = path.join(fullPath, entry.name);
              const subEntries = await fs.promises.readdir(subPath).catch(() => []);
              const folderSignals = subEntries.filter(f => SIGNAL_FILES.includes(f));

              // Recursively get children for nested folders
              const nestedChildren = await getDirectoryChildren(workspacePath, childRelPath);

              children.push({
                  name: entry.name,
                  path: childRelPath,
                  type: "folder",
                  signals: folderSignals,
                  children: nestedChildren
              });
          }
      }
      return children;
  } catch (err) {
      console.error(`Failed to scan ${fullPath}:`, err.message);
      return [];
  }
}

module.exports = { getDirectoryChildren };
