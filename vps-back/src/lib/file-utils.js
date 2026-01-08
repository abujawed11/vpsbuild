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

          // We only care about folders for this picker? 
          // Request said "File Explorer" feel but we are picking *folders*.
          // Displaying files might be nice for context (e.g. package.json), but let's stick to folders + signals for now to keep it clean, 
          // OR include files but disable selection. 
          // The previous implementation showed signals. Let's stick to folders but check for signals.
          
          if (entry.isDirectory()) {
              const childRelPath = path.join(safeRelative, entry.name).replace(/\\/g, "/");
              
              // Check for signals in this folder (shallow scan of its children)
              const subPath = path.join(fullPath, entry.name);
              const subEntries = await fs.promises.readdir(subPath).catch(() => []);
              const folderSignals = subEntries.filter(f => SIGNAL_FILES.includes(f));
              
              // Check if it has subfolders (to show expand arrow)
              // This is an extra read, but improved UX.
              const hasSubfolders = subEntries.some(sub => {
                  try {
                      // We need to know if it is a directory. readdir returns names only unless withFileTypes is true, 
                      // but subEntries above is just names? No, I need withFileTypes for checking children type.
                      // Let's optimize: just mark it as folder. UI will verify on expand.
                      return false; // We won't check deep to avoid perf hit.
                  } catch { return false; }
              });

              children.push({
                  name: entry.name,
                  path: childRelPath,
                  type: "folder",
                  signals: folderSignals,
                  hasChildren: true // Assume true for folders to show arrow, update later if empty?
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
