const fs = require('fs');
const path = require('path');

/**
 * Validates Python project structure before deployment
 */
function validatePythonProject(projectRoot, startCommand) {
    const issues = [];
    const warnings = [];

    // Check requirements.txt exists
    const reqPath = path.join(projectRoot, 'requirements.txt');
    if (!fs.existsSync(reqPath)) {
        warnings.push('requirements.txt not found. Dependencies may not be installed correctly.');
    }

    // Parse entry point from command
    let entryModule = null;
    let entryApp = null;

    // For uvicorn: uvicorn app.main:app -> app/main.py exists?
    if (startCommand.includes('uvicorn')) {
        const match = startCommand.match(/uvicorn\s+([^\s:]+):([^\s]+)/);
        if (match) {
            entryModule = match[1]; // e.g., "app.main"
            entryApp = match[2];    // e.g., "app"

            // Convert module path to file path: app.main -> app/main.py
            const modulePath = entryModule.replace(/\./g, path.sep);
            const pyFile = path.join(projectRoot, modulePath + '.py');

            if (!fs.existsSync(pyFile)) {
                issues.push(`Entry point not found: ${modulePath}.py`);
                issues.push(`Start command expects: ${entryModule}:${entryApp}`);
                issues.push(`But file does not exist at: ${pyFile}`);

                // Try to find similar files
                const suggestions = findSimilarPythonFiles(projectRoot, modulePath);
                if (suggestions.length > 0) {
                    issues.push(`\nDid you mean one of these?`);
                    suggestions.forEach(s => issues.push(`  - ${s}`));
                }
            } else {
                // Check if the app variable exists in the file
                const content = fs.readFileSync(pyFile, 'utf8');
                const hasApp = new RegExp(`\\b${entryApp}\\s*=.*FastAPI`, 'i').test(content);

                if (!hasApp) {
                    warnings.push(`Could not find "${entryApp}" variable in ${modulePath}.py`);
                    warnings.push(`Make sure you have: ${entryApp} = FastAPI()`);
                }
            }
        }
    }

    // For Flask
    if (startCommand.includes('flask run')) {
        const appFile = path.join(projectRoot, 'app.py');
        const mainFile = path.join(projectRoot, 'main.py');

        if (!fs.existsSync(appFile) && !fs.existsSync(mainFile)) {
            issues.push('Flask entry point not found. Expected app.py or main.py');
        }
    }

    // For Django
    if (startCommand.includes('manage.py')) {
        const managePy = path.join(projectRoot, 'manage.py');

        if (!fs.existsSync(managePy)) {
            issues.push('Django manage.py not found. Is this a Django project?');
        }
    }

    return {
        valid: issues.length === 0,
        issues,
        warnings
    };
}

/**
 * Find similar Python files to suggest alternatives
 */
function findSimilarPythonFiles(projectRoot, targetPath) {
    const suggestions = [];

    try {
        const targetFileName = path.basename(targetPath);
        const searchDir = path.dirname(path.join(projectRoot, targetPath));

        if (fs.existsSync(searchDir)) {
            const files = fs.readdirSync(searchDir, { recursive: true });

            files.forEach(file => {
                if (file.endsWith('.py') && file.toLowerCase().includes(targetFileName.toLowerCase())) {
                    // Convert back to module notation
                    const modulePath = file.replace(/\.py$/, '').replace(/[\/\\]/g, '.');
                    suggestions.push(modulePath);
                }
            });
        }

        // Also check root directory
        const rootFiles = fs.readdirSync(projectRoot);
        rootFiles.forEach(file => {
            if (file.endsWith('.py') && file !== '__init__.py') {
                const moduleName = file.replace(/\.py$/, '');
                if (!suggestions.includes(moduleName)) {
                    suggestions.push(moduleName);
                }
            }
        });

    } catch (err) {
        // Ignore errors
    }

    return suggestions.slice(0, 5); // Limit to 5 suggestions
}

module.exports = {
    validatePythonProject
};
