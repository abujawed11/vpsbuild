const { execFile } = require("child_process");
const util = require("util");
const crypto = require("crypto");

const execFilePromise = util.promisify(execFile);

// Docker network for database containers
const GATEWAY_NETWORK = process.env.GATEWAY_NETWORK || "vpsbuilds_default";

// Database port mappings
const DB_PORTS = {
  MYSQL: 3306,
  POSTGRES: 5432,
  MONGODB: 27017,
};

// Database image versions
const DB_IMAGES = {
  MYSQL: "mysql:8.0",
  POSTGRES: "postgres:15-alpine",
  MONGODB: "mongo:7",
};

const ADMIN_USERS = {
  MYSQL: "root",
  POSTGRES: "postgres",
  MONGODB: "root",
};

async function docker(args, { timeout = 30000, env = {} } = {}) {
  return execFilePromise("docker", args, {
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, ...env },
  });
}

async function ensureDockerNetworkExists(networkName = GATEWAY_NETWORK) {
  try {
    await docker(["network", "inspect", networkName], { timeout: 15000 });
  } catch {
    await docker(["network", "create", networkName], { timeout: 30000 });
  }
}

/**
 * Generate a secure random password
 * @param {number} length - Password length
 * @returns {string}
 */
function generatePassword(length = 32) {
  // URL-safe by default; strong enough for DB creds without needing encoding.
  // `base64url` yields [A-Za-z0-9_-].
  return crypto.randomBytes(Math.ceil(length * 0.75)).toString("base64url").slice(0, length);
}

/**
 * Generate a short unique ID for container naming
 * @returns {string}
 */
function generateShortId() {
  return crypto.randomBytes(4).toString("hex").slice(0, 4);
}

/**
 * Generate a slug-safe container name
 * @param {string} name - User-provided name
 * @returns {string}
 */
function generateContainerName(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const shortId = generateShortId();
  return `db-${slug}-${shortId}`;
}

function toSafeIdentifier(raw, { maxLength = 32, fallback = "appdb" } = {}) {
  const safe = String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength);
  return safe || fallback;
}

/**
 * Generate connection URL for a database
 * @param {string} type - Database type (MYSQL, POSTGRES, MONGODB)
 * @param {object} config - Database configuration
 * @returns {string}
 */
function generateConnectionUrl(type, config) {
    const { username, password, host, port, dbName } = config;

    switch (type) {
        case 'MYSQL':
            return `mysql://${username}:${password}@${host}:${port}/${dbName}`;
        case 'POSTGRES':
            return `postgresql://${username}:${password}@${host}:${port}/${dbName}?schema=public`;
        case 'MONGODB':
            return `mongodb://${username}:${password}@${host}:${port}/${dbName}?authSource=${dbName}`;
        default:
            throw new Error(`Unknown database type: ${type}`);
    }
}

/**
 * Create a new database container
 * @param {object} config - Database configuration
 * @returns {Promise<object>} - Container info
 */
async function createDatabaseContainer(config) {
    const {
        type,
        containerName,
        rootPassword,
        volumeName
    } = config;

    const port = DB_PORTS[type];
    const image = DB_IMAGES[type];

    if (!image) {
        throw new Error(`Unknown database type: ${type}`);
    }

    await ensureDockerNetworkExists(GATEWAY_NETWORK);

    const envVars = [];
    let volumePath = "";

    switch (type) {
        case 'MYSQL':
            envVars.push(["MYSQL_ROOT_PASSWORD", rootPassword]);
            volumePath = "/var/lib/mysql";
            break;
        case 'POSTGRES':
            envVars.push(["POSTGRES_USER", ADMIN_USERS.POSTGRES]);
            envVars.push(["POSTGRES_PASSWORD", rootPassword]);
            volumePath = "/var/lib/postgresql/data";
            break;
        case 'MONGODB':
            envVars.push(["MONGO_INITDB_ROOT_USERNAME", ADMIN_USERS.MONGODB]);
            envVars.push(["MONGO_INITDB_ROOT_PASSWORD", rootPassword]);
            volumePath = "/data/db";
            break;
    }

    try {
        const args = [
            "run",
            "-d",
            "--name",
            containerName,
            "--network",
            GATEWAY_NETWORK,
        ];

        for (const [k, v] of envVars) {
            args.push("-e", `${k}=${v}`);
        }

        args.push("-v", `${volumeName}:${volumePath}`);
        args.push("--restart", "unless-stopped");
        args.push("--label", "com.vpsbuilds.type=database");
        args.push("--label", `com.vpsbuilds.dbtype=${type}`);
        args.push(image);

        const { stdout } = await docker(args, { timeout: 60000 });
        const containerId = String(stdout || "").trim();

        return {
            containerId,
            containerName,
            port,
            host: containerName
        };
    } catch (err) {
        throw new Error(`Failed to create database container: ${err.message}`);
    }
}

/**
 * Wait for database container to be healthy
 * @param {string} containerName - Container name
 * @param {string} type - Database type
 * @param {number} maxAttempts - Maximum number of attempts
 * @returns {Promise<boolean>}
 */
async function waitForDatabaseReady(
  containerName,
  type,
  adminPassword,
  { timeoutMs = 120000, adminUsername } = {}
) {
  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    attempt += 1;
    try {
      const { stdout } = await docker(["inspect", "--format={{.State.Status}}", containerName], {
        timeout: 10000,
      });
      const status = String(stdout || "").trim();

      if (status === "running") {
        try {
          switch (type) {
            case "MYSQL":
              await docker(
                [
                  "exec",
                  "-e",
                  `MYSQL_PWD=${adminPassword}`,
                  containerName,
                  "mysqladmin",
                  "-uroot",
                  "ping",
                  "-h",
                  "127.0.0.1",
                  "--silent",
                ],
                { timeout: 5000 }
              );
              return true;
            case "POSTGRES":
              await docker(["exec", containerName, "pg_isready", "-U", ADMIN_USERS.POSTGRES], {
                timeout: 5000,
              });
              return true;
            case "MONGODB":
              const mongoAdminUser = adminUsername || ADMIN_USERS.MONGODB;
              await docker(
                [
                  "exec",
                  containerName,
                  "mongosh",
                  "-u",
                  mongoAdminUser,
                  "-p",
                  adminPassword,
                  "--authenticationDatabase",
                  "admin",
                  "--quiet",
                  "--eval",
                  "db.adminCommand({ ping: 1 })",
                ],
                { timeout: 8000 }
              );
              return true;
          }
        } catch {
          // Fall through to backoff and retry.
        }
      }
    } catch {
      // Ignore until timeout.
    }

    const backoffMs = Math.min(5000, 500 * 2 ** Math.min(attempt, 5));
    await new Promise((r) => setTimeout(r, backoffMs));
  }

  return false;
}

/**
 * Stop a database container
 * @param {string} containerName - Container name
 * @returns {Promise<void>}
 */
async function stopDatabaseContainer(containerName) {
    try {
        await docker(["stop", containerName], { timeout: 30000 });
    } catch (err) {
        if (!err.message.includes('No such container')) {
            throw new Error(`Failed to stop database container: ${err.message}`);
        }
    }
}

/**
 * Start a database container
 * @param {string} containerName - Container name
 * @returns {Promise<void>}
 */
async function startDatabaseContainer(containerName) {
    try {
        await docker(["start", containerName], { timeout: 30000 });
    } catch (err) {
        throw new Error(`Failed to start database container: ${err.message}`);
    }
}

/**
 * Restart a database container
 * @param {string} containerName - Container name
 * @returns {Promise<void>}
 */
async function restartDatabaseContainer(containerName) {
    try {
        await docker(["restart", containerName], { timeout: 60000 });
    } catch (err) {
        throw new Error(`Failed to restart database container: ${err.message}`);
    }
}

/**
 * Delete a database container and its volume
 * @param {string} containerName - Container name
 * @param {string} volumeName - Volume name
 * @returns {Promise<void>}
 */
async function deleteDatabaseContainer(containerName, volumeName) {
    try {
        // Stop container first
        await docker(["stop", containerName], { timeout: 30000 }).catch(() => {});

        // Remove container
        await docker(["rm", containerName], { timeout: 30000 }).catch(() => {});

        // Remove volume
        if (volumeName) {
            await docker(["volume", "rm", volumeName], { timeout: 30000 }).catch(() => {});
        }
    } catch (err) {
        throw new Error(`Failed to delete database container: ${err.message}`);
    }
}

/**
 * Get container status
 * @param {string} containerName - Container name
 * @returns {Promise<string>} - Status (running, stopped, etc.)
 */
async function getContainerStatus(containerName) {
    try {
        const { stdout } = await docker(["inspect", "--format={{.State.Status}}", containerName], {
          timeout: 10000,
        });
        return String(stdout || "").trim();
    } catch {
        return 'unknown';
    }
}

/**
 * Get database container stats
 * @param {string} containerName - Container name
 * @param {string} type - Database type
 * @returns {Promise<object>}
 */
async function getDatabaseStats(containerName, type) {
    const stats = {
        diskUsageMB: 0,
        uptime: 0,
        connections: 0
    };

    try {
        // Get container stats
        await docker(["stats", containerName, "--no-stream", "--format", "{{.MemUsage}}"], {
          timeout: 10000,
        });

        // Get container started time
        const { stdout: startedAt } = await docker(
          ["inspect", "--format={{.State.StartedAt}}", containerName],
          { timeout: 10000 }
        );

        const started = new Date(String(startedAt || "").trim());
        stats.uptime = Math.floor((Date.now() - started.getTime()) / 1000);

        // Get disk usage based on database type
        let diskArgs = null;
        switch (type) {
            case 'MYSQL':
                diskArgs = ["exec", containerName, "du", "-sm", "/var/lib/mysql"];
                break;
            case 'POSTGRES':
                diskArgs = ["exec", containerName, "du", "-sm", "/var/lib/postgresql/data"];
                break;
            case 'MONGODB':
                diskArgs = ["exec", containerName, "du", "-sm", "/data/db"];
                break;
        }

        if (diskArgs) {
            try {
                const { stdout: diskOutput } = await docker(diskArgs, { timeout: 20000 });
                const match = String(diskOutput || "").match(/^(\d+)/);
                if (match) {
                    stats.diskUsageMB = parseInt(match[1], 10);
                }
            } catch {
                // Disk check failed, continue
            }
        }
    } catch (err) {
        console.error('Failed to get database stats:', err.message);
    }

    return stats;
}

/**
 * Parse MySQL error message to be user friendly
 * @param {string} rawError - Raw error string from stderr/stdout
 * @returns {string} - Clean error message
 */
function parseMySQLError(rawError) {
    if (!rawError) return "Unknown error";

    // Standard MySQL error pattern: ERROR <Code> (<State>) at line <Line>: <Message>
    // Example: ERROR 1146 (42S02) at line 1: Table 'testdb.emp1' doesn't exist
    // Use [\s\S] to match any character including newlines
    const match = rawError.match(/ERROR \d+ \([^)]+\) at line \d+: ([\s\S]+)/);
    
    if (match && match[1]) {
        return match[1].trim();
    }
    
    // Fallback: Check for "ERROR <Code>: <Message>" format or just last "ERROR" segment
    if (rawError.includes("ERROR ")) {
        const parts = rawError.split("ERROR ");
        // Get the last part as it's most likely the actual error from the DB
        const lastPart = parts[parts.length - 1];
        
        // If it starts with a number (Error Code), clean it up
        if (/^\d+/.test(lastPart)) {
             // Try to strip "1234 (XY000) at line 1:" prefix
             return lastPart.replace(/^\d+ \([^)]+\) at line \d+:\s*/, "")
                            .replace(/^\d+:\s*/, "") // Strip "1234: "
                            .trim();
        }
        return lastPart.trim();
    }

    return rawError;
}

/**
 * Execute a query on a MySQL database
 * @param {string} containerName - Container name
 * @param {string} dbName - Database name
 * @param {string} username - Database username
 * @param {string} password - Database password
 * @param {string} query - SQL query
 * @returns {Promise<object>}
 */
async function executeMySQLQuery(containerName, dbName, username, password, query) {
    try {
        const startTime = Date.now();
        const { stdout, stderr } = await docker(
          [
            "exec",
            "-e",
            `MYSQL_PWD=${password}`,
            containerName,
            "mysql",
            `-u${username}`,
            dbName,
            "-e",
            query,
            "--batch",
            "--raw",
            "--column-names",
          ],
          { timeout: 30000 }
        );
        const executionTime = Date.now() - startTime;

        // Parse output
        const lines = String(stdout || "").trim().split('\n').filter(l => l.length > 0);

        let fields = lines[0] ? lines[0].split('\t').map(name => ({ name, type: 'unknown' })) : [];

        // If SELECT query returns empty, try to get column names from the table
        if (fields.length === 0 && query.trim().toUpperCase().startsWith('SELECT')) {
            // Extract table name from SELECT query (simple parsing)
            const fromMatch = query.match(/FROM\s+[`"]?(\w+)[`"]?/i);
            if (fromMatch) {
                const tableName = fromMatch[1];
                try {
                    const { stdout: descOut } = await docker(
                      [
                        "exec",
                        "-e",
                        `MYSQL_PWD=${password}`,
                        containerName,
                        "mysql",
                        `-u${username}`,
                        dbName,
                        "-e",
                        `SHOW COLUMNS FROM \`${tableName}\`;`,
                        "--batch",
                        "--raw",
                      ],
                      { timeout: 5000 }
                    );
                    const descLines = String(descOut || "").trim().split('\n').filter(l => l.length > 0);
                    // Skip header line, get field names from first column
                    fields = descLines.slice(1).map(line => {
                        const parts = line.split('\t');
                        return { name: parts[0], type: parts[1] || 'unknown' };
                    });
                } catch (e) {
                    // Ignore errors getting column info
                }
            }
        }

        const rows = lines.slice(1).map(line => {
            const values = line.split('\t');
            const row = {};
            fields.forEach((field, idx) => {
                row[field.name] = values[idx] === 'NULL' ? null : values[idx];
            });
            return row;
        });

        return {
            success: true,
            results: rows,
            fields,
            rowCount: rows.length,
            executionTime
        };
    } catch (err) {
        return {
            success: false,
            error: parseMySQLError(err.message),
            sqlState: null
        };
    }
}

/**
 * Parse Postgres error message
 * @param {string} rawError - Raw error
 * @returns {string} - Clean error
 */
function parsePostgresError(rawError) {
    if (!rawError) return "Unknown error";
    
    // Postgres often returns "ERROR:  message"
    const match = rawError.match(/ERROR:\s+(.+?)(\n|$)/);
    if (match && match[1]) {
        return match[1].trim();
    }
    
    return rawError;
}

/**
 * Execute a query on a PostgreSQL database
 * @param {string} containerName - Container name
 * @param {string} dbName - Database name
 * @param {string} username - Database username
 * @param {string} password - Database password
 * @param {string} query - SQL query
 * @returns {Promise<object>}
 */
async function executePostgresQuery(containerName, dbName, username, password, query) {
    try {
        const startTime = Date.now();
        const { stdout } = await docker(
          [
            "exec",
            "-e",
            `PGPASSWORD=${password}`,
            containerName,
            "psql",
            "-X",
            "-q",
            "-U",
            username,
            "-d",
            dbName,
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            query,
            "-A",
            "-F",
            "\t",
            "-P",
            "footer=off",
          ],
          { timeout: 30000 }
        );
        const executionTime = Date.now() - startTime;

        const output = String(stdout || "").trim();
        const lines = output ? output.split("\n").map((l) => l.trimEnd()).filter((l) => l.trim()) : [];

        const mayReturnRows =
          /^\s*(SELECT|WITH|SHOW|TABLE|VALUES|EXPLAIN)\b/i.test(query || "") ||
          (/\bRETURNING\b/i.test(query || "") && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(query || ""));

        // If it doesn't look like a row-returning query, treat psql output as a message.
        if (!mayReturnRows) {
          return {
            success: true,
            results: [],
            fields: [],
            rowCount: 0,
            executionTime,
            message: output || "OK",
          };
        }

        if (lines.length === 0) {
          return {
            success: true,
            results: [],
            fields: [],
            rowCount: 0,
            executionTime,
          };
        }

        // psql prints a header row even for 0-row SELECTs when tuples_only is off.
        const headerLine = lines[0];
        const headers = headerLine.split("\t").map((h) => h.trim());
        const colCount = headers.length;

        // Drop status line like "INSERT 0 1" if present (common with RETURNING).
        let dataLines = lines.slice(1);
        if (dataLines.length > 0) {
          const last = dataLines[dataLines.length - 1];
          const lastCols = last.split("\t").length;
          const looksLikeStatus = /^(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|GRANT|REVOKE|TRUNCATE|COPY|EXPLAIN|SHOW)\b/i.test(last);
          if (looksLikeStatus || lastCols !== colCount) {
            dataLines = dataLines.slice(0, -1);
          }
        }

        const fields = headers.map((name) => ({ name, type: "unknown" }));
        const results = dataLines.map((line) => {
          const values = line.split("\t");
          const row = {};
          for (let i = 0; i < headers.length; i++) {
            row[headers[i]] = values[i] === "NULL" ? null : (values[i] ?? "");
          }
          return row;
        });

        return {
          success: true,
          results,
          fields,
          rowCount: results.length,
          executionTime,
        };
    } catch (err) {
        return {
            success: false,
            error: parsePostgresError(err.message),
            sqlState: null
        };
    }
}

/**
 * Get list of tables in a database
 * @param {string} containerName - Container name
 * @param {string} type - Database type
 * @param {string} dbName - Database name
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<Array>}
 */
async function listTables(containerName, type, dbName, username, password) {
    switch (type) {
        case 'MYSQL':
            try {
              const { stdout } = await docker(
                [
                  "exec",
                  "-e",
                  `MYSQL_PWD=${password}`,
                  containerName,
                  "mysql",
                  `-u${username}`,
                  dbName,
                  "-e",
                  "SHOW TABLES;",
                  "--batch",
                  "--raw",
                ],
                { timeout: 10000 }
              );
              return String(stdout || "")
                .trim()
                .split("\n")
                .filter((t) => t.trim() && !t.startsWith("Tables_in_"));
            } catch (err) {
              throw new Error(`Failed to list tables: ${err.message}`);
            }
        case 'POSTGRES':
            try {
              const { stdout } = await docker(
                [
                  "exec",
                  "-e",
                  `PGPASSWORD=${password}`,
                  containerName,
                  "psql",
                  "-U",
                  username,
                  "-d",
                  dbName,
                  "-c",
                  "SELECT tablename FROM pg_tables WHERE schemaname = 'public';",
                  "-t",
                  "-A",
                ],
                { timeout: 10000 }
              );
              return String(stdout || "")
                .trim()
                .split("\n")
                .filter((t) => t.trim());
            } catch (err) {
              throw new Error(`Failed to list tables: ${err.message}`);
            }
        case 'MONGODB':
            try {
              const attempt = async (authDb) => {
                const { stdout } = await docker(
                  [
                    "exec",
                    containerName,
                    "mongosh",
                    dbName,
                    "-u",
                    username,
                    "-p",
                    password,
                    "--authenticationDatabase",
                    authDb,
                    "--eval",
                    "db.getCollectionNames()",
                    "--quiet",
                  ],
                  { timeout: 15000 }
                );
                return String(stdout || "")
                  .trim()
                  .split("\n")
                  .filter((t) => t.trim());
              };

              try {
                return await attempt(dbName);
              } catch {
                // Legacy containers often have the admin user in `admin`.
                return await attempt("admin");
              }
            } catch (err) {
              throw new Error(`Failed to list tables: ${err.message}`);
            }
        default:
            return [];
    }
}

/**
 * Get table schema
 * @param {string} containerName - Container name
 * @param {string} type - Database type
 * @param {string} dbName - Database name
 * @param {string} tableName - Table name
 * @param {string} username - Username
 * @param {string} password - Password
 * @returns {Promise<object>}
 */
async function getTableSchema(containerName, type, dbName, tableName, username, password) {
    try {
        let stdout = "";
        if (type === "MYSQL") {
          ({ stdout } = await docker(
            [
              "exec",
              "-e",
              `MYSQL_PWD=${password}`,
              containerName,
              "mysql",
              `-u${username}`,
              dbName,
              "-e",
              `DESCRIBE \`${tableName}\`;`,
              "--batch",
              "--raw",
            ],
            { timeout: 10000 }
          ));
        } else if (type === "POSTGRES") {
          ({ stdout } = await docker(
            [
              "exec",
              "-e",
              `PGPASSWORD=${password}`,
              containerName,
              "psql",
              "-U",
              username,
              "-d",
              dbName,
              "-c",
              `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${tableName.replace(/'/g, "''")}' ORDER BY ordinal_position;`,
              "-t",
              "-A",
              "-F",
              "\t",
            ],
            { timeout: 10000 }
          ));
        } else {
          return { columns: [] };
        }

        const lines = String(stdout || "").trim().split('\n').filter(l => l.trim());

        let columns = [];

        if (type === 'MYSQL') {
            // MySQL DESCRIBE format: Field, Type, Null, Key, Default, Extra
            // First line is header, skip it
            const dataLines = lines.slice(1);
            columns = dataLines.map(line => {
                const parts = line.split('\t');
                return {
                    name: parts[0] || '',
                    type: parts[1] || '',
                    nullable: parts[2] === 'YES',
                    key: parts[3] || null,
                    default: parts[4] === 'NULL' ? null : parts[4],
                    extra: parts[5] || ''
                };
            });
        } else if (type === 'POSTGRES') {
            // PostgreSQL format: column_name, data_type, is_nullable, column_default
            columns = lines.map(line => {
                const parts = line.split('\t');
                return {
                    name: parts[0] || '',
                    type: parts[1] || '',
                    nullable: parts[2] === 'YES',
                    default: parts[3] || null
                };
            });
        }

        return { columns };
    } catch (err) {
        throw new Error(`Failed to get table schema: ${err.message}`);
    }
}

async function mysqlAdminExec(containerName, rootPassword, sql) {
  await docker(
    ["exec", "-e", `MYSQL_PWD=${rootPassword}`, containerName, "mysql", "-uroot", "-e", sql],
    { timeout: 30000 }
  );
}

async function postgresAdminExec(containerName, adminUsername, adminPassword, database, sql) {
  await docker(
    [
      "exec",
      "-e",
      `PGPASSWORD=${adminPassword}`,
      containerName,
      "psql",
      "-U",
      adminUsername,
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { timeout: 45000 }
  );
}

async function mongoAdminEval(containerName, adminUsername, adminPassword, js) {
  await docker(
    [
      "exec",
      containerName,
      "mongosh",
      "-u",
      adminUsername,
      "-p",
      adminPassword,
      "--authenticationDatabase",
      "admin",
      "--quiet",
      "--eval",
      js,
    ],
    { timeout: 45000 }
  );
}

// ============================================
// SQLite Support Functions
// ============================================

/**
 * Execute a query on a SQLite database file inside a container
 * @param {string} containerName - Container name where the .db file lives
 * @param {string} filePath - Path to the .db file inside the container
 * @param {string} query - SQL query
 * @returns {Promise<object>}
 */
async function executeSQLiteQuery(containerName, filePath, query) {
  try {
    const startTime = Date.now();

    // Execute sqlite3 inside the container
    // Use -header -separator to get consistent output
    const { stdout, stderr } = await docker(
      [
        "exec",
        containerName,
        "sqlite3",
        "-header",
        "-separator",
        "\t",
        filePath,
        query
      ],
      { timeout: 30000 }
    );
    const executionTime = Date.now() - startTime;

    const output = String(stdout || "").trim();

    // Check if this is a non-SELECT query (INSERT, UPDATE, DELETE, CREATE, etc.)
    const isSelectQuery = /^\s*(SELECT|PRAGMA|WITH)\b/i.test(query);

    if (!isSelectQuery) {
      return {
        success: true,
        results: [],
        fields: [],
        rowCount: 0,
        executionTime,
        message: output || "Query executed successfully"
      };
    }

    if (!output) {
      return {
        success: true,
        results: [],
        fields: [],
        rowCount: 0,
        executionTime
      };
    }

    // Parse tabular output
    const lines = output.split('\n').filter(l => l.trim());

    if (lines.length === 0) {
      return {
        success: true,
        results: [],
        fields: [],
        rowCount: 0,
        executionTime
      };
    }

    // First line is headers
    const headers = lines[0].split('\t');
    const fields = headers.map(name => ({ name, type: 'unknown' }));

    // Rest are data rows
    const results = lines.slice(1).map(line => {
      const values = line.split('\t');
      const row = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] === '' ? null : values[idx];
      });
      return row;
    });

    return {
      success: true,
      results,
      fields,
      rowCount: results.length,
      executionTime
    };
  } catch (err) {
    return {
      success: false,
      error: parseSQLiteError(err.message),
      sqlState: null
    };
  }
}

/**
 * Parse SQLite error message
 * @param {string} rawError - Raw error
 * @returns {string} - Clean error
 */
function parseSQLiteError(rawError) {
  if (!rawError) return "Unknown error";

  // SQLite errors often contain "Error:" prefix
  const match = rawError.match(/Error:\s*(.+?)(\n|$)/i);
  if (match && match[1]) {
    return match[1].trim();
  }

  // Check for "near" syntax errors
  const nearMatch = rawError.match(/near\s+"[^"]+":.*$/im);
  if (nearMatch) {
    return nearMatch[0];
  }

  return rawError;
}

/**
 * List tables in a SQLite database
 * @param {string} containerName - Container name
 * @param {string} filePath - Path to .db file
 * @returns {Promise<Array>}
 */
async function listSQLiteTables(containerName, filePath) {
  try {
    const { stdout } = await docker(
      [
        "exec",
        containerName,
        "sqlite3",
        filePath,
        ".tables"
      ],
      { timeout: 10000 }
    );

    // .tables returns space-separated table names, possibly on multiple lines
    return String(stdout || "")
      .trim()
      .split(/\s+/)
      .filter(t => t.trim());
  } catch (err) {
    throw new Error(`Failed to list SQLite tables: ${err.message}`);
  }
}

/**
 * Get SQLite table schema
 * @param {string} containerName - Container name
 * @param {string} filePath - Path to .db file
 * @param {string} tableName - Table name
 * @returns {Promise<object>}
 */
async function getSQLiteTableSchema(containerName, filePath, tableName) {
  try {
    const { stdout } = await docker(
      [
        "exec",
        containerName,
        "sqlite3",
        "-header",
        "-separator",
        "\t",
        filePath,
        `PRAGMA table_info('${tableName.replace(/'/g, "''")}');`
      ],
      { timeout: 10000 }
    );

    const lines = String(stdout || "").trim().split('\n').filter(l => l.trim());

    if (lines.length <= 1) {
      return { columns: [] };
    }

    // PRAGMA table_info returns: cid, name, type, notnull, dflt_value, pk
    const dataLines = lines.slice(1); // Skip header
    const columns = dataLines.map(line => {
      const parts = line.split('\t');
      return {
        name: parts[1] || '',
        type: parts[2] || '',
        nullable: parts[3] !== '1',
        default: parts[4] || null,
        key: parts[5] === '1' ? 'PRI' : null
      };
    });

    return { columns };
  } catch (err) {
    throw new Error(`Failed to get SQLite table schema: ${err.message}`);
  }
}

/**
 * Check if a SQLite file exists in a container
 * @param {string} containerName - Container name
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
async function checkSQLiteFileExists(containerName, filePath) {
  try {
    await docker(
      ["exec", containerName, "test", "-f", filePath],
      { timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Get SQLite database info (file size, table count)
 * @param {string} containerName - Container name
 * @param {string} filePath - Path to .db file
 * @returns {Promise<object>}
 */
async function getSQLiteStats(containerName, filePath) {
  const stats = {
    diskUsageMB: 0,
    tableCount: 0,
    uptime: 0, // Not applicable for SQLite
    connections: 0 // Not applicable for SQLite
  };

  try {
    // Get file size
    const { stdout: sizeOut } = await docker(
      ["exec", containerName, "stat", "-c", "%s", filePath],
      { timeout: 5000 }
    );
    const bytes = parseInt(String(sizeOut || "").trim(), 10);
    if (!isNaN(bytes)) {
      stats.diskUsageMB = Math.round(bytes / (1024 * 1024) * 100) / 100;
    }

    // Get table count
    const { stdout: tablesOut } = await docker(
      ["exec", containerName, "sqlite3", filePath, "SELECT COUNT(*) FROM sqlite_master WHERE type='table';"],
      { timeout: 5000 }
    );
    const count = parseInt(String(tablesOut || "").trim(), 10);
    if (!isNaN(count)) {
      stats.tableCount = count;
    }
  } catch (err) {
    console.error('Failed to get SQLite stats:', err.message);
  }

  return stats;
}

module.exports = {
    generatePassword,
    generateShortId,
    generateContainerName,
    toSafeIdentifier,
    generateConnectionUrl,
    ensureDockerNetworkExists,
    createDatabaseContainer,
    waitForDatabaseReady,
    stopDatabaseContainer,
    startDatabaseContainer,
    restartDatabaseContainer,
    deleteDatabaseContainer,
    getContainerStatus,
    getDatabaseStats,
    executeMySQLQuery,
    executePostgresQuery,
    listTables,
    getTableSchema,
    mysqlAdminExec,
    postgresAdminExec,
    mongoAdminEval,
    // SQLite functions
    executeSQLiteQuery,
    listSQLiteTables,
    getSQLiteTableSchema,
    checkSQLiteFileExists,
    getSQLiteStats,
    DB_PORTS,
    DB_IMAGES,
    ADMIN_USERS,
    GATEWAY_NETWORK,
};
