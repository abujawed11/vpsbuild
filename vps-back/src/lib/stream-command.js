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
        // Parse command and args
        const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g);
        const cmd = parts[0];
        const args = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''));

        const proc = spawn(cmd, args, {
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
