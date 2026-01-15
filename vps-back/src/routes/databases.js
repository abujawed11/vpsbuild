const express = require("express");
const { prisma } = require("../db/prisma");
const { authRequired } = require("../middleware/auth");
const {
    generatePassword,
    generateShortId,
    generateContainerName,
    toSafeIdentifier,
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
    postgresAdminExec,
    mongoAdminEval,
    ADMIN_USERS,
    DB_PORTS
} = require("../lib/database-manager");
const { encryptSecret, decryptSecret, redactSecrets } = require("../lib/credentials-crypto");
const {
    provisionManagedDatabase,
    resetManagedDatabase,
} = require("../lib/managed-database-provisioner");

const router = express.Router();

// Mask password in connection URL
function maskConnectionUrl(url) {
    return url.replace(/:([^:@]+)@/, ':****@');
}

function getEnvKeysForType(type) {
    if (type === "MONGODB") return { primary: "MONGO_URL", compat: "DATABASE_URL" };
    return { primary: "DATABASE_URL", compat: null };
}

function maskedConnectionUrlForDatabase(db) {
    return maskConnectionUrl(
        generateConnectionUrl(db.type, {
            username: db.dbUsername,
            password: "****",
            host: db.host,
            port: db.port,
            dbName: db.dbName
        })
    );
}

async function getDbPasswordPlain(database) {
    const plain = decryptSecret(database.dbPasswordEncrypted);
    // Opportunistic re-encrypt of legacy plaintext-at-rest rows.
    if (database.dbPasswordEncrypted && !String(database.dbPasswordEncrypted).startsWith("v1:")) {
        await prisma.database.update({
            where: { id: database.id },
            data: { dbPasswordEncrypted: encryptSecret(plain) }
        }).catch(() => {});
    }
    return plain;
}

async function getRootPasswordPlain(database) {
    const plain = decryptSecret(database.rootPasswordEncrypted);
    if (database.rootPasswordEncrypted && !String(database.rootPasswordEncrypted).startsWith("v1:")) {
        await prisma.database.update({
            where: { id: database.id },
            data: { rootPasswordEncrypted: encryptSecret(plain) }
        }).catch(() => {});
    }
    return plain;
}

async function resolveAdminAuth(database) {
    if (database.type === "MYSQL") {
        const rootPassword = await getRootPasswordPlain(database);
        return { adminUsername: ADMIN_USERS.MYSQL, adminPassword: rootPassword };
    }

    if (database.type === "POSTGRES") {
        const candidates = [
            { adminUsername: ADMIN_USERS.POSTGRES, adminPassword: await getRootPasswordPlain(database) },
            // Legacy: DB user was created as superuser in POSTGRES_USER
            { adminUsername: database.dbUsername, adminPassword: await getDbPasswordPlain(database) }
        ];

        for (const c of candidates) {
            try {
                await postgresAdminExec(database.containerName, c.adminUsername, c.adminPassword, "postgres", "SELECT 1;");
                return c;
            } catch {
                // try next
            }
        }
        throw new Error("Failed to authenticate to Postgres as admin");
    }

    if (database.type === "MONGODB") {
        const candidates = [
            { adminUsername: ADMIN_USERS.MONGODB, adminPassword: await getRootPasswordPlain(database) },
            // Legacy: root user == db user
            { adminUsername: database.dbUsername, adminPassword: await getDbPasswordPlain(database) }
        ];

        for (const c of candidates) {
            try {
                await mongoAdminEval(database.containerName, c.adminUsername, c.adminPassword, "db.adminCommand({ ping: 1 })");
                return c;
            } catch {
                // try next
            }
        }
        throw new Error("Failed to authenticate to MongoDB as admin");
    }

    throw new Error(`Unsupported database type: ${database.type}`);
}

function sanitizeDatabase(db, { includeProvisioning = false } = {}) {
    return {
        id: db.id,
        userId: db.userId,
        name: db.name,
        containerName: db.containerName,
        type: db.type,
        version: db.version,
        dbName: db.dbName,
        username: db.dbUsername,
        host: db.host,
        port: db.port,
        status: db.status,
        volumeName: db.volumeName,
        diskUsageMB: db.diskUsageMB,
        linkedProjectId: db.linkedProjectId || null,
        project: db.project || null,
        createdAt: db.createdAt,
        updatedAt: db.updatedAt,
        lastError: db.lastError || null,
        lastProvisionLog: db.lastProvisionLog || null,
        provisioningLog: includeProvisioning ? (db.provisioningLog || null) : undefined,
        connectionUrl: maskedConnectionUrlForDatabase(db),
    };
}

async function persistProvisioning(databaseId, provisioningLog, { lastError = null, lastProvisionLog = null, status = null } = {}) {
    const data = { provisioningLog, lastError, lastProvisionLog };
    if (status) data.status = status;
    await prisma.database.update({ where: { id: databaseId }, data }).catch(() => {});
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
                if (!['ERROR', 'FAILED', 'DELETING'].includes(db.status) &&
                    prismaStatus !== db.status &&
                    ['RUNNING', 'STOPPED'].includes(prismaStatus)) {
                    await prisma.database.update({
                        where: { id: db.id },
                        data: { status: prismaStatus }
                    });
                }

                return sanitizeDatabase({ ...db, status: prismaStatus }, { includeProvisioning: false });
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

        res.json(sanitizeDatabase({ ...database, status: currentStatus }, { includeProvisioning: true }));
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

    let createdDatabaseId = null;
    try {
        const trimmedName = String(name).trim();
        if (trimmedName.length < 2 || trimmedName.length > 40) {
            return res.status(400).json({ error: "Name must be 2-40 characters" });
        }

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
        const containerName = generateContainerName(trimmedName);
        const volumeName = `${containerName}-data`;
        let dbName = toSafeIdentifier(trimmedName, { maxLength: 32, fallback: "appdb" });
        let dbUsername = toSafeIdentifier(`u_${req.user.id.slice(0, 6)}_${generateShortId()}`, { maxLength: 32, fallback: "appuser" }).replace(/^[^a-zA-Z]+/, "u");
        const dbPassword = generatePassword(32);
        const rootPassword = generatePassword(32);
        const port = DB_PORTS[type];
        const host = containerName;

        // Create database record first (with CREATING status)
        const provisioningLog = [];
        const database = await prisma.database.create({
            data: {
                userId: req.user.id,
                name: trimmedName,
                containerName,
                type,
                version: type === 'MYSQL' ? '8.0' : type === 'POSTGRES' ? '15' : '7',
                dbName,
                dbUsername,
                dbPasswordEncrypted: encryptSecret(dbPassword),
                rootPasswordEncrypted: encryptSecret(rootPassword),
                host,
                port,
                status: 'CREATING',
                volumeName,
                diskUsageMB: 0,
                linkedProjectId: null,
                provisioningLog
            }
        });
        createdDatabaseId = database.id;

        const secretsToRedact = [dbPassword, rootPassword];
        const step = async (stepName, fn) => {
            const entry = { step: stepName, status: "IN_PROGRESS", startedAt: new Date().toISOString() };
            provisioningLog.push(entry);
            await persistProvisioning(database.id, provisioningLog, { lastError: null });
            try {
                const result = await fn();
                entry.status = "SUCCESS";
                entry.finishedAt = new Date().toISOString();
                await persistProvisioning(database.id, provisioningLog, { lastError: null });
                return result;
            } catch (e) {
                entry.status = "FAILED";
                entry.finishedAt = new Date().toISOString();
                entry.message = redactSecrets(e.message || String(e), secretsToRedact);
                const lastProvisionLog = JSON.stringify(provisioningLog);
                await persistProvisioning(database.id, provisioningLog, {
                    status: "ERROR",
                    lastError: entry.message,
                    lastProvisionLog
                });
                throw e;
            }
        };

        await step("START_CONTAINER", async () => {
            await createDatabaseContainer({
                type,
                containerName,
                rootPassword,
                volumeName
            });
        });

        await step("WAIT_READY", async () => {
            const isReady = await waitForDatabaseReady(containerName, type, rootPassword, { timeoutMs: 120000 });
            if (!isReady) throw new Error("Database container did not become ready in time");
        });

        await step("PROVISION", async () => {
            const adminUsername = type === "MYSQL" ? ADMIN_USERS.MYSQL : type === "POSTGRES" ? ADMIN_USERS.POSTGRES : ADMIN_USERS.MONGODB;
            const adminPassword = rootPassword;
            const { dbName: safeDbName, dbUsername: safeDbUsername } = await provisionManagedDatabase({
                type,
                containerName,
                dbName,
                dbUsername,
                dbPassword,
                adminUsername,
                adminPassword
            });

            // Keep record aligned with normalized identifiers.
            if (safeDbName !== dbName || safeDbUsername !== dbUsername) {
                dbName = safeDbName;
                dbUsername = safeDbUsername;
                await prisma.database.update({
                    where: { id: database.id },
                    data: { dbName: safeDbName, dbUsername: safeDbUsername }
                });
            }
        });

        await step("SAVE_RECORD", async () => {
            await prisma.database.update({
                where: { id: database.id },
                data: { status: "RUNNING", lastError: null }
            });
        });

        if (projectId) {
            await step("LINK_PROJECT", async () => {
                await prisma.project.update({
                    where: { id: projectId },
                    data: { databaseId: database.id }
                });

                const connectionUrl = generateConnectionUrl(type, {
                    username: dbUsername,
                    password: dbPassword,
                    host,
                    port,
                    dbName
                });

                const { primary, compat } = getEnvKeysForType(type);

                await prisma.envVar.upsert({
                    where: { projectId_key: { projectId, key: primary } },
                    create: { projectId, key: primary, value: connectionUrl },
                    update: { value: connectionUrl }
                });

                if (compat) {
                    await prisma.envVar.upsert({
                        where: { projectId_key: { projectId, key: compat } },
                        create: { projectId, key: compat, value: connectionUrl },
                        update: { value: connectionUrl }
                    });
                }

                await prisma.database.update({
                    where: { id: database.id },
                    data: { linkedProjectId: projectId }
                });
            });
        }

        // Return response with credentials (shown only once)
        const connectionUrl = generateConnectionUrl(type, {
            username: dbUsername,
            password: dbPassword,
            host,
            port,
            dbName
        });

        res.json({
            success: true,
            database: {
                id: database.id,
                name: trimmedName,
                type,
                version: type === 'MYSQL' ? '8.0' : type === 'POSTGRES' ? '15' : '7',
                status: 'RUNNING',
                host,
                port,
                dbName,
                username: dbUsername,
                password: dbPassword, // only returned on creation
                connectionUrl, // full URL with password (shown once)
                passwordShownOnce: true,
                provisioningLog
            },
            linkedProjectId: projectId || null,
            redeployRecommended: Boolean(projectId)
        });

    } catch (err) {
        if (err.code === 'P2002') {
            return res.status(400).json({ error: "Database name already exists" });
        }
        console.error(err);
        res.status(500).json({
            error: "Failed to create database",
            details: err.message,
            databaseId: createdDatabaseId
        });
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

            const { primary, compat } = getEnvKeysForType(database.type);
            const keys = compat ? [primary, compat] : [primary];
            await prisma.envVar.deleteMany({ where: { projectId: linkedProject.id, key: { in: keys } } });
        }

        await prisma.database.update({
            where: { id: database.id },
            data: { linkedProjectId: null }
        }).catch(() => {});

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

        // Wait for it to be ready
        let readinessPassword = database.type === "MONGODB"
            ? await getRootPasswordPlain(database)
            : (await getRootPasswordPlain(database)).toString();

        let isReady = await waitForDatabaseReady(database.containerName, database.type, readinessPassword, { timeoutMs: 60000 });
        if (!isReady && database.type === "MONGODB") {
            // Legacy mongo: root user == db user
            const dbPassword = await getDbPasswordPlain(database);
            isReady = await waitForDatabaseReady(database.containerName, database.type, dbPassword, { timeoutMs: 60000, adminUsername: database.dbUsername });
        }

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

        let readinessPassword = database.type === "MONGODB"
            ? await getRootPasswordPlain(database)
            : (await getRootPasswordPlain(database)).toString();

        let isReady = await waitForDatabaseReady(database.containerName, database.type, readinessPassword, { timeoutMs: 90000 });
        if (!isReady && database.type === "MONGODB") {
            const dbPassword = await getDbPasswordPlain(database);
            isReady = await waitForDatabaseReady(database.containerName, database.type, dbPassword, { timeoutMs: 90000, adminUsername: database.dbUsername });
        }

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

        if (database.linkedProjectId && database.linkedProjectId !== projectId) {
            return res.status(400).json({ error: "Database is already linked to a project" });
        }

        // Link database to project
        await prisma.project.update({
            where: { id: projectId },
            data: { databaseId: database.id }
        });

        const dbPassword = await getDbPasswordPlain(database);
        const { primary, compat } = getEnvKeysForType(database.type);

        // Add connection URL to project env vars
        const connectionUrl = generateConnectionUrl(database.type, {
            username: database.dbUsername,
            password: dbPassword,
            host: database.host,
            port: database.port,
            dbName: database.dbName
        });

        await prisma.envVar.upsert({
            where: {
                projectId_key: { projectId, key: primary }
            },
            create: {
                projectId,
                key: primary,
                value: connectionUrl
            },
            update: {
                value: connectionUrl
            }
        });

        if (compat) {
            await prisma.envVar.upsert({
                where: { projectId_key: { projectId, key: compat } },
                create: { projectId, key: compat, value: connectionUrl },
                update: { value: connectionUrl }
            });
        }

        await prisma.database.update({
            where: { id: database.id },
            data: { linkedProjectId: projectId }
        });

        res.json({
            success: true,
            message: "Database linked to project",
            envVarAdded: true,
            redeployRecommended: true,
            envKeys: compat ? [primary, compat] : [primary]
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
        const { primary, compat } = getEnvKeysForType(database.type);
        const keys = compat ? [primary, compat] : [primary];
        await prisma.envVar.deleteMany({ where: { projectId: linkedProject.id, key: { in: keys } } });

        await prisma.database.update({
            where: { id: database.id },
            data: { linkedProjectId: null }
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
            const dbPassword = await getDbPasswordPlain(database);
            const tables = await listTables(
                database.containerName,
                database.type,
                database.dbName,
                database.dbUsername,
                dbPassword
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

        const dbPassword = await getDbPasswordPlain(database);
        let result;
        switch (database.type) {
            case 'MYSQL':
                result = await executeMySQLQuery(
                    database.containerName,
                    database.dbName,
                    database.dbUsername,
                    dbPassword,
                    query
                );
                break;
            case 'POSTGRES':
                result = await executePostgresQuery(
                    database.containerName,
                    database.dbName,
                    database.dbUsername,
                    dbPassword,
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

        const dbPassword = await getDbPasswordPlain(database);
        const tables = await listTables(
            database.containerName,
            database.type,
            database.dbName,
            database.dbUsername,
            dbPassword
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

        const dbPassword = await getDbPasswordPlain(database);
        const schema = await getTableSchema(
            database.containerName,
            database.type,
            database.dbName,
            req.params.tableName,
            database.dbUsername,
            dbPassword
        );

        res.json({ tableName: req.params.tableName, ...schema });
    } catch (err) {
        console.error(err);
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
        const dbPassword = await getDbPasswordPlain(database);
        if (database.type === 'MYSQL') {
            result = await executeMySQLQuery(
                database.containerName,
                database.dbName,
                database.dbUsername,
                dbPassword,
                query
            );
        } else {
            result = await executePostgresQuery(
                database.containerName,
                database.dbName,
                database.dbUsername,
                dbPassword,
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

        const newPassword = generatePassword(32);

        const { adminUsername, adminPassword } = await resolveAdminAuth(database);

        // Reconcile user + password + grants in one idempotent step
        await provisionManagedDatabase({
            type: database.type,
            containerName: database.containerName,
            dbName: database.dbName,
            dbUsername: database.dbUsername,
            dbPassword: newPassword,
            adminUsername,
            adminPassword
        });

        // Update password at rest
        await prisma.database.update({
            where: { id: database.id },
            data: { dbPasswordEncrypted: encryptSecret(newPassword), lastError: null }
        });

        // Update DATABASE_URL in linked project
        const linkedProject = await prisma.project.findFirst({
            where: { databaseId: database.id }
        });

        if (linkedProject) {
            const connectionUrl = generateConnectionUrl(database.type, {
                username: database.dbUsername,
                password: newPassword,
                host: database.host,
                port: database.port,
                dbName: database.dbName
            });

            const { primary, compat } = getEnvKeysForType(database.type);
            await prisma.envVar.upsert({
                where: {
                    projectId_key: { projectId: linkedProject.id, key: primary }
                },
                create: {
                    projectId: linkedProject.id,
                    key: primary,
                    value: connectionUrl
                },
                update: {
                    value: connectionUrl
                }
            });

            if (compat) {
                await prisma.envVar.upsert({
                    where: { projectId_key: { projectId: linkedProject.id, key: compat } },
                    create: { projectId: linkedProject.id, key: compat, value: connectionUrl },
                    update: { value: connectionUrl }
                });
            }
        }

        // Return new credentials
        const connectionUrl = generateConnectionUrl(database.type, {
            username: database.dbUsername,
            password: newPassword,
            host: database.host,
            port: database.port,
            dbName: database.dbName
        });

        res.json({
            success: true,
            password: newPassword,
            connectionUrl,
            passwordShownOnce: true
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to reset password" });
    }
});

// POST /api/databases/:id/reset - Reset database (wipe schema/data, keep credentials)
router.post("/:id/reset", authRequired, async (req, res) => {
    const { confirmName, confirmPhrase } = req.body || {};

    try {
        const database = await prisma.database.findUnique({
            where: { id: req.params.id }
        });

        if (!database || database.userId !== req.user.id) {
            return res.status(404).json({ error: "Database not found" });
        }

        if (!confirmName || String(confirmName).trim() !== String(database.name).trim()) {
            return res.status(400).json({ error: "Confirmation name does not match" });
        }

        const requiredPhrase = "I understand data will be lost";
        if (!confirmPhrase || String(confirmPhrase).trim() !== requiredPhrase) {
            return res.status(400).json({ error: `Confirmation phrase must be exactly: "${requiredPhrase}"` });
        }

        const { adminUsername, adminPassword } = await resolveAdminAuth(database);
        const dbPassword = await getDbPasswordPlain(database);

        await resetManagedDatabase({
            type: database.type,
            containerName: database.containerName,
            dbName: database.dbName,
            dbUsername: database.dbUsername,
            dbPassword,
            adminUsername,
            adminPassword
        });

        await prisma.database.update({
            where: { id: database.id },
            data: { lastError: null }
        });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to reset database" });
    }
});

module.exports = router;
