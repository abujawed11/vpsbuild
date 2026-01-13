/**
 * Extract port from command string
 */
function extractPortFromCommand(command) {
  if (!command) return null;

  // Patterns to match port specifications
  const patterns = [
    /--port[= ](\d+)/i,           // --port 4000 or --port=4000
    /-p[= ](\d+)/i,                // -p 4000 or -p=4000
    /--bind[= ][^\s]*:(\d+)/i,    // --bind 0.0.0.0:5000 or --bind :5000
    /:(\d+)(?:\s|$)/               // Standalone :8000
  ];

  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match && match[1]) {
      const port = parseInt(match[1]);
      if (port > 0 && port < 65536) {
        return port;
      }
    }
  }

  return null;
}

/**
 * Detect appropriate port based on runtime, framework, and start command
 */
function detectPort(config) {
  // Priority 1: Explicit port in start command
  if (config.startCommand) {
    const portFromCommand = extractPortFromCommand(config.startCommand);
    if (portFromCommand) {
      return portFromCommand;
    }
  }

  // Priority 2: Framework-specific defaults
  if (config.runtime === "python") {
    if (config.framework === "flask") return 5000;
    if (config.framework === "django") return 8000;
    if (config.framework === "fastapi") return 8000;
    // Default for Python
    return 8000;
  }

  if (config.runtime === "node") {
    if (config.framework === "nextjs") return 3000;
    if (config.framework === "express") return 3000;
    if (config.framework === "nestjs") return 3000;
    // Default for Node.js
    return 3000;
  }

  // Priority 3: Fallback
  return 3000;
}

module.exports = { detectPort, extractPortFromCommand };
