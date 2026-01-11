const fs = require('fs');
const path = require('path');

/**
 * Python Framework Detection and Command Builder
 * Automatically detects framework and builds proper start commands
 */

/**
 * Detect Python framework from requirements.txt or start command
 */
function detectPythonFramework(projectRoot, startCommand) {
    const reqPath = path.join(projectRoot, 'requirements.txt');
    let requirements = '';

    if (fs.existsSync(reqPath)) {
        requirements = fs.readFileSync(reqPath, 'utf8').toLowerCase();
    }

    // Check start command first
    const cmd = startCommand.toLowerCase();

    if (cmd.includes('uvicorn') || requirements.includes('fastapi') || requirements.includes('uvicorn')) {
        return { framework: 'fastapi', server: 'uvicorn' };
    }

    if (cmd.includes('flask') || requirements.includes('flask')) {
        return { framework: 'flask', server: 'flask' };
    }

    if (cmd.includes('django') || cmd.includes('manage.py') || requirements.includes('django')) {
        return { framework: 'django', server: 'django' };
    }

    if (cmd.includes('gunicorn') || requirements.includes('gunicorn')) {
        return { framework: 'wsgi', server: 'gunicorn' };
    }

    // Default fallback
    return { framework: 'python', server: 'python' };
}

/**
 * Build production-ready start command with proper host and port binding
 */
function buildPythonStartCommand(startCommand, port = 5000) {
    const cmd = startCommand.trim();

    // FastAPI / Uvicorn
    if (cmd.includes('uvicorn')) {
        // Check if host and port are already specified
        const hasHost = /--host\s+\S+/.test(cmd);
        const hasPort = /--port\s+\d+/.test(cmd);

        let finalCmd = cmd;

        if (!hasHost) {
            finalCmd += ' --host 0.0.0.0';
        }

        if (!hasPort) {
            finalCmd += ` --port ${port}`;
        }

        return finalCmd;
    }

    // Flask
    if (cmd.includes('flask run')) {
        const hasHost = /--host[=\s]/.test(cmd);
        const hasPort = /--port[=\s]/.test(cmd);

        let finalCmd = cmd;

        if (!hasHost) {
            finalCmd += ' --host=0.0.0.0';
        }

        if (!hasPort) {
            finalCmd += ` --port=${port}`;
        }

        return finalCmd;
    }

    // Django
    if (cmd.includes('manage.py runserver')) {
        // Check if already has host:port
        const hasBinding = /runserver\s+[\d.]+:\d+/.test(cmd);

        if (!hasBinding) {
            // Replace "runserver" with "runserver 0.0.0.0:port"
            return cmd.replace(/runserver\s*$/, `runserver 0.0.0.0:${port}`);
        }

        return cmd;
    }

    // Gunicorn
    if (cmd.includes('gunicorn')) {
        const hasBind = /--bind\s+\S+/.test(cmd) || /-b\s+\S+/.test(cmd);

        if (!hasBind) {
            return `${cmd} --bind 0.0.0.0:${port}`;
        }

        return cmd;
    }

    // Fallback: return as-is
    return cmd;
}

/**
 * Get framework-specific presets for UI
 */
function getPythonFrameworkPresets() {
    return {
        fastapi: {
            name: 'FastAPI',
            defaultCommand: 'uvicorn main:app',
            defaultPort: 8000,
            installCommand: 'pip install -r requirements.txt',
            description: 'Modern async Python web framework'
        },
        flask: {
            name: 'Flask',
            defaultCommand: 'flask run',
            defaultPort: 5000,
            installCommand: 'pip install -r requirements.txt',
            description: 'Lightweight WSGI web framework'
        },
        django: {
            name: 'Django',
            defaultCommand: 'python manage.py runserver',
            defaultPort: 8000,
            installCommand: 'pip install -r requirements.txt',
            description: 'High-level Python web framework'
        },
        gunicorn: {
            name: 'Gunicorn (WSGI)',
            defaultCommand: 'gunicorn app:app',
            defaultPort: 8000,
            installCommand: 'pip install -r requirements.txt',
            description: 'Production WSGI HTTP server'
        },
        python: {
            name: 'Python (Generic)',
            defaultCommand: 'python app.py',
            defaultPort: 5000,
            installCommand: 'pip install -r requirements.txt',
            description: 'Generic Python application'
        }
    };
}

/**
 * Validate start command and provide helpful suggestions
 */
function validatePythonStartCommand(startCommand, framework) {
    const issues = [];
    const suggestions = [];

    const cmd = startCommand.toLowerCase();

    // Check for common mistakes
    if (framework === 'fastapi' && !cmd.includes('uvicorn')) {
        issues.push('FastAPI apps should use uvicorn to run');
        suggestions.push('Try: uvicorn main:app');
    }

    if (framework === 'flask' && cmd.includes('python') && !cmd.includes('flask run')) {
        suggestions.push('Consider using "flask run" for better development experience');
    }

    if (cmd.includes('127.0.0.1') || cmd.includes('localhost')) {
        issues.push('Do not bind to 127.0.0.1 or localhost - container will not be accessible');
        suggestions.push('Remove host binding - platform will add 0.0.0.0 automatically');
    }

    return { valid: issues.length === 0, issues, suggestions };
}

module.exports = {
    detectPythonFramework,
    buildPythonStartCommand,
    getPythonFrameworkPresets,
    validatePythonStartCommand
};
