const { spawn } = require('child_process');

/**
 * Execute a command and stream output line-by-line to a callback
 * @param {string} command - The command to execute
 * @param {object} options - Spawn options (cwd, env, etc.)
 * @param {function} onOutput - Callback for each line of output
 * @returns {Promise<void>}
 */
function streamCommand(command, options = {}, onOutput) {
    return new Promise((resolve, reject) => {
        // When using shell: true, pass the entire command as-is to preserve quoting
        // This properly handles paths with spaces like "/path/to/my project"
        const proc = spawn(command, [], {
            ...options,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';

        // Stream stdout line by line
        proc.stdout.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    onOutput(line);
                }
            });
            stdout += data.toString();
        });

        // Stream stderr line by line
        proc.stderr.on('data', (data) => {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    onOutput(line);
                }
            });
            stderr += data.toString();
        });

        proc.on('error', (error) => {
            reject(new Error(`Command failed: ${error.message}`));
        });

        proc.on('close', (code) => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                const error = new Error(`Command exited with code ${code}`);
                error.stdout = stdout;
                error.stderr = stderr;
                reject(error);
            }
        });
    });
}

module.exports = { streamCommand };
