const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const {
    generatePassword,
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
    DB_PORTS
} = require("../lib/database-manager");

const router = express.Router();

// Mask password in connection URL
function maskConnectionUrl(url) {
    return url.replace(/:([^:@]+)@/, ':****@');
}

// ============================================
// CRUD ENDPOINTS
// ============================================

// GET /api/databases - List all databases for user
router.get("/", authRequired, async (req, res) => {
    try {
        const databases = await prisma.database.findMany({
            where: { userId: req.user.id },
            orderBy: { createdAt: "desc" },
            include: {
                project: {
                    select: { id: true, name: true, slug: true }
                }
            }
        });

        // Update status and mask passwords
        const databasesWithStatus = await Promise.all(
            databases.map(async (db) => {
                const status = await getContainerStatus(db.containerName);
                const prismaStatus = status === 'running' ? 'RUNNING' :
                    status === 'exited' ? 'STOPPED' : db.status;

                // Update status in DB if changed
                if (prismaStatus !== db.status && ['RUNNING', 'STOPPED'].includes(prismaStatus)) {
                    await prisma.database.update({
                        where: { id: db.id },
                        data: { status: prismaStatus }
                    });
                }

                return {
                    ...db,
                    status: prismaStatus,
                    password: undefined,
                    rootPassword: undefined,
                    connectionUrl: maskConnectionUrl(
                        generateConnectionUrl(db.type, {
                            username: db.username,
                            password: db.password,
                            host: db.host,
                            port: db.port,
                            dbName: db.dbName
                        })
                    )
                };
            })
        );

        res.json({ databases: databasesWithStatus });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch databases" });
    }
});

// GET /api/databases/:id - Get database details
router.get("/:id", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id },
            include: {
                project: {
                    select: { id: true, name: true, slug: true }
                }
            }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        // Get current status
        const status = await getContainerStatus(database.containerName);
        const currentStatus = status === 'running' ? 'RUNNING' :
            status === 'exited' ? 'STOPPED' : database.status;

        res.json({
            ...database,
            status: currentStatus,
            password: undefined,
            rootPassword: undefined,
            connectionUrl: maskConnectionUrl(
                generateConnectionUrl(database.type, {
                    username: database.username,
                    password: database.password,
                    host: database.host,
                    port: database.port,
                    dbName: database.dbName
                })
            )
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch database" });
    }
});

// POST /api/databases - Create new database
router.post("/", authRequired, async (req, res) => {
    const { name, type, projectId } = req.body;

    if (!name) {
        return res.status(400).json({ error: "Name is required" });
    }

    if (!type || !['MYSQL', 'POSTGRES', 'MONGODB'].includes(type)) {
        return res.status(400).json({ error: "Valid database type is required (MYSQL, POSTGRES, MONGODB)" });
    }

    try {
        // Check if project exists and belongs to user (if projectId provided)
        if (projectId) {
            const project = await prisma.project.findUnique({
                where: { id: projectId }
            });
            if (!project || project.userId !== req.user.id) {
                return res.status(404).json({ error: "Project not found" });
            }
            if (project.databaseId) {
                return res.status(400).json({ error: "Project already has a database linked" });
            }
        }

        // Generate credentials
        const containerName = generateContainerName(name);
        const volumeName = `${containerName}-data`;
        const dbName = name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 32) || 'appdb';
        const username = 'dbuser';
        const password = generatePassword(16);
        const rootPassword = generatePassword(20);
        const port = DB_PORTS[type];
        const host = containerName;

        // Create database record first (with CREATING status)
        const database = await prisma.database.create({
            data: {
                userId: req.user.id,
                name,
                containerName,
                type,
                version: type === 'MYSQL' ? '8.0' : type === 'POSTGRES' ? '15' : '7',
                dbName,
                username,
                password,
                rootPassword,
                host,
                port,
                status: 'CREATING',
                volumeName,
                diskUsageMB: 0
            }
        });

        // Create Docker container (async)
        createDatabaseContainer({
            type,
            containerName,
            dbName,
            username,
            password,
            rootPassword,
            volumeName
        }).then(async () => {
            // Wait for database to be ready
            const isReady = await waitForDatabaseReady(containerName, type);

            if (isReady) {
                await prisma.database.update({
                    where: { id: database.id },
                    data: { status: 'RUNNING' }
                });

                // Link to project if provided
                if (projectId) {
                    await prisma.project.update({
                        where: { id: projectId },
                        data: { databaseId: database.id }
                    });

                    // Add DATABASE_URL to project env vars
                    const connectionUrl = generateConnectionUrl(type, {
                        username, password, host, port, dbName
                    });

                    await prisma.envVar.upsert({
                        where: {
                            projectId_key: { projectId, key: 'DATABASE_URL' }
                        },
                        create: {
                            projectId,
                            key: 'DATABASE_URL',
                            value: connectionUrl
                        },
                        update: {
                            value: connectionUrl
                        }
                    });
                }
            } else {
                await prisma.database.update({
                    where: { id: database.id },
                    data: { status: 'FAILED' }
                });
            }
        }).catch(async (err) => {
            console.error('Failed to create database container:', err);
            await prisma.database.update({
                where: { id: database.id },
                data: { status: 'FAILED' }
            });
        });

        // Return response with credentials (shown only once)
        const connectionUrl = generateConnectionUrl(type, {
            username, password, host, port, dbName
        });

        res.json({
            success: true,
            database: {
                id: database.id,
                name: database.name,
                type: database.type,
                status: 'CREATING',
                host,
                port,
                dbName,
                username,
                password, // Only returned on creation!
                connectionUrl // Full URL with password
            }
        });

    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ error: "Database name already exists" });
        }
        console.error(err);
        res.status(500).json({ error: "Failed to create database" });
    }
});

// DELETE /api/databases/:id - Delete database
router.delete("/:id", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        // Update status to DELETING
        await prisma.database.update({
            where: { id: database.id },
            data: { status: 'DELETING' }
        });

        // Unlink from project if linked
        const linkedProject = await prisma.project.findFirst({
            where: { databaseId: database.id }
        });

        if (linkedProject) {
            await prisma.project.update({
                where: { id: linkedProject.id },
                data: { databaseId: null }
            });

            // Remove DATABASE_URL env var
            await prisma.envVar.deleteMany({
                where: {
                    projectId: linkedProject.id,
                    key: 'DATABASE_URL'
                }
            });
        }

        // Delete Docker container and volume
        await deleteDatabaseContainer(database.containerName, database.volumeName);

        // Delete database record
        await prisma.database.delete({
            where: { id: database.id }
        });

        res.json({ success: true, message: "Database deleted successfully" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to delete database" });
    }
});

// ============================================
// CONTROL ENDPOINTS (Start/Stop/Restart)
// ============================================

// POST /api/databases/:id/start
router.post("/:id/start", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        await startDatabaseContainer(database.containerName);

        // Wait for it to be running
        const isReady = await waitForDatabaseReady(database.containerName, database.type, 15);

        if (isReady) {
            await prisma.database.update({
                where: { id: database.id },
                data: { status: 'RUNNING' }
            });
            res.json({ success: true, status: 'RUNNING' });
        } else {
            res.status(500).json({ error: "Database started but not responding" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to start database" });
    }
});

// POST /api/databases/:id/stop
router.post("/:id/stop", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        await stopDatabaseContainer(database.containerName);

        await prisma.database.update({
            where: { id: database.id },
            data: { status: 'STOPPED' }
        });

        res.json({ success: true, status: 'STOPPED' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to stop database" });
    }
});

// POST /api/databases/:id/restart
router.post("/:id/restart", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        await restartDatabaseContainer(database.containerName);

        // Wait for it to be running
        const isReady = await waitForDatabaseReady(database.containerName, database.type, 30);

        if (isReady) {
            await prisma.database.update({
                where: { id: database.id },
                data: { status: 'RUNNING' }
            });
            res.json({ success: true, status: 'RUNNING' });
        } else {
            res.status(500).json({ error: "Database restarted but not responding" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to restart database" });
    }
});

// ============================================
// PROJECT LINKING ENDPOINTS
// ============================================

// POST /api/databases/:id/link-project
router.post("/:id/link-project", authRequired, async (req, res) => {
    const { projectId } = req.body;

    if (!projectId) {
        return res.status(400).json({ error: "Project ID is required" });
    }

    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        const project = await prisma.project.findUnique({
            where: { id: projectId }
        });

        if (!project || project.userId !== req.user.id) {
            return res.status(404).json({ error: "Project not found" });
        }

        if (project.databaseId) {
            return res.status(400).json({ error: "Project already has a database linked" });
        }

        // Link database to project
        await prisma.project.update({
            where: { id: projectId },
            data: { databaseId: database.id }
        });

        // Add DATABASE_URL to project env vars
        const connectionUrl = generateConnectionUrl(database.type, {
            username: database.username,
            password: database.password,
            host: database.host,
            port: database.port,
            dbName: database.dbName
        });

        await prisma.envVar.upsert({
            where: {
                projectId_key: { projectId, key: 'DATABASE_URL' }
            },
            create: {
                projectId,
                key: 'DATABASE_URL',
                value: connectionUrl
            },
            update: {
                value: connectionUrl
            }
        });

        res.json({
            success: true,
            message: "Database linked to project",
            envVarAdded: true
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to link database to project" });
    }
});

// POST /api/databases/:id/unlink-project
router.post("/:id/unlink-project", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        // Find linked project
        const linkedProject = await prisma.project.findFirst({
            where: { databaseId: database.id }
        });

        if (!linkedProject) {
            return res.status(400).json({ error: "Database is not linked to any project" });
        }

        // Unlink
        await prisma.project.update({
            where: { id: linkedProject.id },
            data: { databaseId: null }
        });

        // Remove DATABASE_URL env var
        await prisma.envVar.deleteMany({
            where: {
                projectId: linkedProject.id,
                key: 'DATABASE_URL'
            }
        });

        res.json({
            success: true,
            message: "Database unlinked from project"
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to unlink database from project" });
    }
});

// ============================================
// STATS ENDPOINT
// ============================================

// GET /api/databases/:id/stats
router.get("/:id/stats", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        const stats = await getDatabaseStats(database.containerName, database.type);

        // Update disk usage in database
        if (stats.diskUsageMB > 0) {
            await prisma.database.update({
                where: { id: database.id },
                data: { diskUsageMB: stats.diskUsageMB }
            });
        }

        // Get table count
        let tableCount = 0;
        try {
            const tables = await listTables(
                database.containerName,
                database.type,
                database.dbName,
                database.username,
                database.password
            );
            tableCount = tables.length;
        } catch {
            // Ignore table count errors
        }

        res.json({
            diskUsageMB: stats.diskUsageMB,
            tableCount,
            uptime: stats.uptime,
            connections: stats.connections
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch database stats" });
    }
});

// ============================================
// QUERY EXECUTOR ENDPOINTS
// ============================================

// POST /api/databases/:id/query
router.post("/:id/query", authRequired, async (req, res) => {
    const { query } = req.body;

    if (!query) {
        return res.status(400).json({ error: "Query is required" });
    }

    // Basic security: Block dangerous commands
    const upperQuery = query.toUpperCase().trim();
    const blockedCommands = ['GRANT', 'REVOKE', 'CREATE USER', 'DROP USER', 'ALTER USER', 'SET PASSWORD', 'FLUSH'];
    for (const cmd of blockedCommands) {
        if (upperQuery.startsWith(cmd)) {
            return res.status(403).json({ error: `Command not allowed: ${cmd}` });
        }
    }

    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        // Update last accessed
        await prisma.database.update({
            where: { id: database.id },
            data: { lastAccessedAt: new Date() }
        });

        let result;
        switch (database.type) {
            case 'MYSQL':
                result = await executeMySQLQuery(
                    database.containerName,
                    database.dbName,
                    database.username,
                    database.password,
                    query
                );
                break;
            case 'POSTGRES':
                result = await executePostgresQuery(
                    database.containerName,
                    database.dbName,
                    database.username,
                    database.password,
                    query
                );
                break;
            case 'MONGODB':
                return res.status(400).json({ error: "MongoDB query execution not supported yet" });
            default:
                return res.status(400).json({ error: "Unknown database type" });
        }

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to execute query" });
    }
});

// GET /api/databases/:id/tables - List all tables
router.get("/:id/tables", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        const tables = await listTables(
            database.containerName,
            database.type,
            database.dbName,
            database.username,
            database.password
        );

        res.json({ tables: tables.map(name => ({ name })) });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to list tables" });
    }
});

// GET /api/databases/:id/tables/:tableName - Get table schema
router.get("/:id/tables/:tableName", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        console.log(`[Schema] Fetching schema for table: ${req.params.tableName}`);

        const schema = await getTableSchema(
            database.containerName,
            database.type,
            database.dbName,
            req.params.tableName,
            database.username,
            database.password
        );

        console.log(`[Schema] Result:`, JSON.stringify(schema));

        res.json({ tableName: req.params.tableName, ...schema });
    } catch (err) {
        console.error('[Schema] Error:', err);
        res.status(500).json({ error: "Failed to get table schema" });
    }
});

// GET /api/databases/:id/tables/:tableName/rows - Browse table data
router.get("/:id/tables/:tableName/rows", authRequired, async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = (page - 1) * limit;

    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        const tableName = req.params.tableName;
        let query = '';

        switch (database.type) {
            case 'MYSQL':
                query = `SELECT * FROM \`${tableName}\` LIMIT ${limit} OFFSET ${offset}`;
                break;
            case 'POSTGRES':
                query = `SELECT * FROM "${tableName}" LIMIT ${limit} OFFSET ${offset}`;
                break;
            default:
                return res.status(400).json({ error: "Unsupported database type" });
        }

        let result;
        if (database.type === 'MYSQL') {
            result = await executeMySQLQuery(
                database.containerName,
                database.dbName,
                database.username,
                database.password,
                query
            );
        } else {
            result = await executePostgresQuery(
                database.containerName,
                database.dbName,
                database.username,
                database.password,
                query
            );
        }

        if (!result.success) {
            return res.status(500).json({ error: result.error });
        }

        res.json({
            rows: result.results,
            page,
            limit,
            rowCount: result.rowCount
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to browse table data" });
    }
});

// POST /api/databases/:id/reset-password - Reset database password
router.post("/:id/reset-password", authRequired, async (req, res) => {
    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        const newPassword = generatePassword(16);

        // Update password in container
        let cmd = '';
        switch (database.type) {
            case 'MYSQL':
                cmd = `docker exec ${database.containerName} mysql -uroot -p'${database.rootPassword}' -e "ALTER USER '${database.username}'@'%' IDENTIFIED BY '${newPassword}';"`;
                break;
            case 'POSTGRES':
                cmd = `docker exec ${database.containerName} psql -U ${database.username} -c "ALTER USER ${database.username} PASSWORD '${newPassword}';"`;
                break;
            default:
                return res.status(400).json({ error: "Password reset not supported for this database type" });
        }

        const { exec } = require('child_process');
        const util = require('util');
        const execPromise = util.promisify(exec);

        await execPromise(cmd);

        // Update password in database
        await prisma.database.update({
            where: { id: database.id },
            data: { password: newPassword }
        });

        // Update DATABASE_URL in linked project
        const linkedProject = await prisma.project.findFirst({
            where: { databaseId: database.id }
        });

        if (linkedProject) {
            const connectionUrl = generateConnectionUrl(database.type, {
                username: database.username,
                password: newPassword,
                host: database.host,
                port: database.port,
                dbName: database.dbName
            });

            await prisma.envVar.upsert({
                where: {
                    projectId_key: { projectId: linkedProject.id, key: 'DATABASE_URL' }
                },
                create: {
                    projectId: linkedProject.id,
                    key: 'DATABASE_URL',
                    value: connectionUrl
                },
                update: {
                    value: connectionUrl
                }
            });
        }

        // Return new credentials
        const connectionUrl = generateConnectionUrl(database.type, {
            username: database.username,
            password: newPassword,
            host: database.host,
            port: database.port,
            dbName: database.dbName
        });

        res.json({
            success: true,
            password: newPassword,
            connectionUrl
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to reset password" });
    }
});

module.exports = router;
