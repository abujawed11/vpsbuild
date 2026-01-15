const { exec } = require('child_process');
const util = require('util');
const crypto = require('crypto');

const execPromise = util.promisify(exec);

// Docker network for database containers
const GATEWAY_NETWORK = process.env.GATEWAY_NETWORK || 'vpsbuilds_default';

// Database port mappings
const DB_PORTS = {
    MYSQL: 3306,
    POSTGRES: 5432,
    MONGODB: 27017
};

// Database image versions
const DB_IMAGES = {
    MYSQL: 'mysql:8.0',
    POSTGRES: 'postgres:15-alpine',
    MONGODB: 'mongo:7'
};

/**
 * Generate a secure random password
 * @param {number} length - Password length
 * @returns {string}
 */
function generatePassword(length = 16) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let password = '';
    const randomBytes = crypto.randomBytes(length);
    for (let i = 0; i < length; i++) {
        password += chars[randomBytes[i] % chars.length];
    }
    return password;
}

/**
 * Generate a short unique ID for container naming
 * @returns {string}
 */
function generateShortId() {
    return crypto.randomBytes(4).toString('hex').slice(0, 4);
}

/**
 * Generate a slug-safe container name
 * @param {string} name - User-provided name
 * @returns {string}
 */
function generateContainerName(name) {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 20);
    const shortId = generateShortId();
    return `db-${slug}-${shortId}`;
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
            return `postgresql://${username}:${password}@${host}:${port}/${dbName}`;
        case 'MONGODB':
            return `mongodb://${username}:${password}@${host}:${port}/${dbName}?authSource=admin`;
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
        dbName,
        username,
        password,
        rootPassword,
        volumeName
    } = config;

    const port = DB_PORTS[type];
    const image = DB_IMAGES[type];

    if (!image) {
        throw new Error(`Unknown database type: ${type}`);
    }

    let envVars = [];
    let volumePath = '';

    switch (type) {
        case 'MYSQL':
            envVars = [
                `-e MYSQL_ROOT_PASSWORD="${rootPassword}"`,
                `-e MYSQL_DATABASE="${dbName}"`,
                `-e MYSQL_USER="${username}"`,
                `-e MYSQL_PASSWORD="${password}"`
            ];
            volumePath = '/var/lib/mysql';
            break;
        case 'POSTGRES':
            envVars = [
                `-e POSTGRES_DB="${dbName}"`,
                `-e POSTGRES_USER="${username}"`,
                `-e POSTGRES_PASSWORD="${password}"`
            ];
            volumePath = '/var/lib/postgresql/data';
            break;
        case 'MONGODB':
            envVars = [
                `-e MONGO_INITDB_ROOT_USERNAME="${username}"`,
                `-e MONGO_INITDB_ROOT_PASSWORD="${password}"`,
                `-e MONGO_INITDB_DATABASE="${dbName}"`
            ];
            volumePath = '/data/db';
            break;
    }

    const dockerCmd = [
        'docker run -d',
        `--name ${containerName}`,
        `--network ${GATEWAY_NETWORK}`,
        ...envVars,
        `-v ${volumeName}:${volumePath}`,
        '--restart unless-stopped',
        `--label com.vpsbuilds.type=database`,
        `--label com.vpsbuilds.dbtype=${type}`,
        image
    ].join(' ');

    try {
        const { stdout } = await execPromise(dockerCmd, { timeout: 60000 });
        const containerId = stdout.trim();

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
async function waitForDatabaseReady(containerName, type, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const { stdout } = await execPromise(
                `docker inspect --format='{{.State.Status}}' ${containerName}`
            );
            const status = stdout.trim().replace(/'/g, '');

            if (status === 'running') {
                // Additional health check based on database type
                let healthCmd = '';
                switch (type) {
                    case 'MYSQL':
                        healthCmd = `docker exec ${containerName} mysqladmin ping -h localhost --silent`;
                        break;
                    case 'POSTGRES':
                        healthCmd = `docker exec ${containerName} pg_isready -U postgres`;
                        break;
                    case 'MONGODB':
                        healthCmd = `docker exec ${containerName} mongosh --eval "db.adminCommand('ping')" --quiet`;
                        break;
                }

                if (healthCmd) {
                    try {
                        await execPromise(healthCmd, { timeout: 5000 });
                        return true;
                    } catch {
                        // Not ready yet, continue waiting
                    }
                } else {
                    return true;
                }
            }
        } catch {
            // Container not ready yet
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
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
        await execPromise(`docker stop ${containerName}`, { timeout: 30000 });
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
        await execPromise(`docker start ${containerName}`, { timeout: 30000 });
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
        await execPromise(`docker restart ${containerName}`, { timeout: 60000 });
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
        await execPromise(`docker stop ${containerName}`).catch(() => {});

        // Remove container
        await execPromise(`docker rm ${containerName}`).catch(() => {});

        // Remove volume
        if (volumeName) {
            await execPromise(`docker volume rm ${volumeName}`).catch(() => {});
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
        const { stdout } = await execPromise(
            `docker inspect --format='{{.State.Status}}' ${containerName}`
        );
        return stdout.trim().replace(/'/g, '');
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
        const { stdout: statsOutput } = await execPromise(
            `docker stats ${containerName} --no-stream --format "{{.MemUsage}}"`
        );

        // Get container started time
        const { stdout: startedAt } = await execPromise(
            `docker inspect --format='{{.State.StartedAt}}' ${containerName}`
        );

        const started = new Date(startedAt.trim().replace(/'/g, ''));
        stats.uptime = Math.floor((Date.now() - started.getTime()) / 1000);

        // Get disk usage based on database type
        let diskCmd = '';
        switch (type) {
            case 'MYSQL':
                diskCmd = `docker exec ${containerName} du -sm /var/lib/mysql`;
                break;
            case 'POSTGRES':
                diskCmd = `docker exec ${containerName} du -sm /var/lib/postgresql/data`;
                break;
            case 'MONGODB':
                diskCmd = `docker exec ${containerName} du -sm /data/db`;
                break;
        }

        if (diskCmd) {
            try {
                const { stdout: diskOutput } = await execPromise(diskCmd);
                const match = diskOutput.match(/^(\d+)/);
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
 * Execute a query on a MySQL database
 * @param {string} containerName - Container name
 * @param {string} dbName - Database name
 * @param {string} username - Database username
 * @param {string} password - Database password
 * @param {string} query - SQL query
 * @returns {Promise<object>}
 */
async function executeMySQLQuery(containerName, dbName, username, password, query) {
    // Escape single quotes in query
    const escapedQuery = query.replace(/'/g, "'\\''");

    const cmd = `docker exec ${containerName} mysql -u${username} -p'${password}' ${dbName} -e '${escapedQuery}' --batch --raw`;

    try {
        const startTime = Date.now();
        const { stdout, stderr } = await execPromise(cmd, { timeout: 30000 });
        const executionTime = Date.now() - startTime;

        // Parse output
        const lines = stdout.trim().split('\n');
        const fields = lines[0] ? lines[0].split('\t').map(name => ({ name, type: 'unknown' })) : [];
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
            error: err.message,
            sqlState: null
        };
    }
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
    // Escape for shell
    const escapedQuery = query.replace(/'/g, "'\\''");

    const cmd = `docker exec -e PGPASSWORD='${password}' ${containerName} psql -U ${username} -d ${dbName} -c '${escapedQuery}' -t -A -F '\t'`;

    try {
        const startTime = Date.now();
        const { stdout } = await execPromise(cmd, { timeout: 30000 });
        const executionTime = Date.now() - startTime;

        const lines = stdout.trim().split('\n').filter(l => l.trim());

        // For simple queries, parse tab-separated output
        const rows = lines.map(line => {
            const values = line.split('\t');
            return values;
        });

        return {
            success: true,
            results: rows,
            fields: [],
            rowCount: rows.length,
            executionTime
        };
    } catch (err) {
        return {
            success: false,
            error: err.message,
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
    let cmd = '';

    switch (type) {
        case 'MYSQL':
            cmd = `docker exec ${containerName} mysql -u${username} -p'${password}' ${dbName} -e 'SHOW TABLES;' --batch --raw`;
            break;
        case 'POSTGRES':
            cmd = `docker exec -e PGPASSWORD='${password}' ${containerName} psql -U ${username} -d ${dbName} -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public';" -t -A`;
            break;
        case 'MONGODB':
            cmd = `docker exec ${containerName} mongosh ${dbName} -u ${username} -p '${password}' --authenticationDatabase admin --eval "db.getCollectionNames()" --quiet`;
            break;
    }

    try {
        const { stdout } = await execPromise(cmd, { timeout: 10000 });
        const tables = stdout.trim().split('\n').filter(t => t.trim() && !t.startsWith('Tables_in_'));
        return tables;
    } catch (err) {
        throw new Error(`Failed to list tables: ${err.message}`);
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
    let cmd = '';

    switch (type) {
        case 'MYSQL':
            cmd = `docker exec ${containerName} mysql -u${username} -p'${password}' ${dbName} -e 'DESCRIBE ${tableName};' --batch --raw`;
            break;
        case 'POSTGRES':
            cmd = `docker exec -e PGPASSWORD='${password}' ${containerName} psql -U ${username} -d ${dbName} -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = '${tableName}' ORDER BY ordinal_position;" -t -A -F '\t'`;
            break;
    }

    try {
        console.log(`[getTableSchema] Running command: ${cmd}`);
        const { stdout } = await execPromise(cmd, { timeout: 10000 });
        console.log(`[getTableSchema] Raw output:`, stdout);
        const lines = stdout.trim().split('\n').filter(l => l.trim());
        console.log(`[getTableSchema] Lines:`, lines);

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

module.exports = {
    generatePassword,
    generateShortId,
    generateContainerName,
    generateConnectionUrl,
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
    DB_PORTS,
    DB_IMAGES
};
