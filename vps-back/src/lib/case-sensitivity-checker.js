const fs = require('fs');
const path = require('path');

/**
 * Detects case-sensitivity issues in build errors
 * @param {string} errorMessage - The build error message
 * @param {string} projectRoot - The project root directory
 * @returns {object|null} - Details about the case issue, or null if not a case issue
 */
function detectCaseSensitivityIssue(errorMessage, projectRoot) {
    // Pattern: Could not resolve "./Shuffle" from "src/pages/HomePage.jsx"
    const resolvePattern = /Could not resolve ["']([^"']+)["'] from ["']([^"']+)["']/i;
    const match = errorMessage.match(resolvePattern);

    if (!match) return null;

    const [, importPath, sourceFile] = match;

    // Get the directory of the source file
    const sourceDir = path.dirname(path.join(projectRoot, sourceFile));

    // Handle relative imports
    let targetPath;
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
        targetPath = path.resolve(sourceDir, importPath);
    } else {
        // Could be a node_modules import or alias - skip for now
        return null;
    }

    // Check if file exists with exact case
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
    let exactMatch = false;

    for (const ext of extensions) {
        if (fs.existsSync(targetPath + ext)) {
            exactMatch = true;
            break;
        }
    }

    if (exactMatch) return null; // Not a case sensitivity issue

    // Now check if a case-insensitive version exists
    const targetDir = path.dirname(targetPath);
    const targetBasename = path.basename(targetPath);

    if (!fs.existsSync(targetDir)) return null;

    const filesInDir = fs.readdirSync(targetDir);

    // Find case-insensitive matches
    for (const file of filesInDir) {
        const fileWithoutExt = file.replace(/\.(jsx?|tsx?|mjs|cjs)$/, '');

        if (fileWithoutExt.toLowerCase() === targetBasename.toLowerCase() &&
            fileWithoutExt !== targetBasename) {

            return {
                importPath,
                sourceFile,
                expectedFile: targetBasename,
                actualFile: fileWithoutExt,
                fullPath: path.join(targetDir, file),
                suggestion: `Change import from "${importPath}" to "./${fileWithoutExt}"`
            };
        }
    }

    return null;
}

/**
 * Formats a helpful error message for case-sensitivity issues
 */
function formatCaseSensitivityError(caseIssue) {
    return `
╔════════════════════════════════════════════════════════════════╗
║  CASE SENSITIVITY ERROR DETECTED                               ║
╚════════════════════════════════════════════════════════════════╝

Your code works on Windows but fails on Linux due to case-sensitive
file imports.

📁 File: ${caseIssue.sourceFile}
❌ Import: ${caseIssue.importPath}
✅ Actual filename: ${caseIssue.actualFile}

🔧 FIX: ${caseIssue.suggestion}

Windows is case-insensitive (Shuffle.jsx = shuffle.jsx)
Linux is case-sensitive (Shuffle.jsx ≠ shuffle.jsx)

Please update your import statement to match the exact filename case.
`;
}

module.exports = {
    detectCaseSensitivityIssue,
    formatCaseSensitivityError
};
