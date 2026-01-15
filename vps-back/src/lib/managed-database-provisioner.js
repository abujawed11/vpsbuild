const {
  mysqlAdminExec,
  postgresAdminExec,
  mongoAdminEval,
  toSafeIdentifier,
} = require("./database-manager");

function assertSafeUsername(username) {
  if (!/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/.test(username)) {
    throw new Error(
      "Invalid dbUsername. Must start with a letter and contain only letters, numbers, underscore (max 32 chars)."
    );
  }
}

function assertSafeDbName(dbName) {
  if (!/^[a-z0-9_]{1,64}$/.test(dbName)) {
    throw new Error("Invalid dbName.");
  }
}

function escapePgLiteral(value) {
  return String(value).replace(/'/g, "''");
}

async function provisionMySQL({ containerName, dbName, dbUsername, dbPassword, rootPassword }) {
  assertSafeDbName(dbName);
  assertSafeUsername(dbUsername);

  const sql = [
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`,
    `CREATE USER IF NOT EXISTS '${dbUsername}'@'%' IDENTIFIED BY '${dbPassword}';`,
    `ALTER USER '${dbUsername}'@'%' IDENTIFIED BY '${dbPassword}';`,
    `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUsername}'@'%';`,
    "FLUSH PRIVILEGES;",
  ].join("\n");

  await mysqlAdminExec(containerName, rootPassword, sql);
}

async function provisionPostgres({
  containerName,
  dbName,
  dbUsername,
  dbPassword,
  adminUsername,
  adminPassword,
}) {
  // Postgres identifiers allow much more, but we intentionally keep a conservative subset.
  assertSafeDbName(dbName);
  assertSafeUsername(dbUsername);

  const role = dbUsername;
  const database = dbName;
  const pwdLit = escapePgLiteral(dbPassword);

  // Create role (idempotent) and enforce password correctness
  try {
    await postgresAdminExec(
      containerName,
      adminUsername,
      adminPassword,
      "postgres",
      `CREATE ROLE "${role}" LOGIN PASSWORD '${pwdLit}';`
    );
  } catch (e) {
    // role already exists
    if (!/already exists/i.test(String(e.message || e))) throw e;
  }

  await postgresAdminExec(
    containerName,
    adminUsername,
    adminPassword,
    "postgres",
    `ALTER ROLE "${role}" WITH PASSWORD '${pwdLit}';`
  );

  // Create database (idempotent) - cannot run inside a function/DO block
  try {
    await postgresAdminExec(
      containerName,
      adminUsername,
      adminPassword,
      "postgres",
      `CREATE DATABASE "${database}";`
    );
  } catch (e) {
    if (!/already exists/i.test(String(e.message || e))) throw e;
  }

  // Grant DB privileges (connect/create/temp)
  await postgresAdminExec(
    containerName,
    adminUsername,
    adminPassword,
    "postgres",
    `GRANT ALL PRIVILEGES ON DATABASE "${database}" TO "${role}";`
  );

  // Ensure schema privileges for Prisma/ORMs
  await postgresAdminExec(
    containerName,
    adminUsername,
    adminPassword,
    database,
    `
GRANT USAGE, CREATE ON SCHEMA public TO "${role}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${role}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${role}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO "${role}";
`.trim()
  );
}

async function provisionMongo({
  containerName,
  dbName,
  dbUsername,
  dbPassword,
  adminUsername,
  adminPassword,
}) {
  assertSafeDbName(dbName);
  assertSafeUsername(dbUsername);

  const js = `
const dbName = ${JSON.stringify(dbName)};
const username = ${JSON.stringify(dbUsername)};
const pwd = ${JSON.stringify(dbPassword)};
const roles = [
  { role: "readWrite", db: dbName },
  { role: "dbAdmin", db: dbName }
];
const targetDb = db.getSiblingDB(dbName);
const existing = targetDb.getUser(username);
if (existing) {
  targetDb.updateUser(username, { pwd, roles });
} else {
  targetDb.createUser({ user: username, pwd, roles });
}
`.trim();

  await mongoAdminEval(containerName, adminUsername, adminPassword, js);
}

async function provisionManagedDatabase({
  type,
  containerName,
  dbName,
  dbUsername,
  dbPassword,
  adminUsername,
  adminPassword,
}) {
  // Normalize/lock-in conservative identifiers.
  const safeDbName = toSafeIdentifier(dbName, { maxLength: 32, fallback: "appdb" });
  const safeDbUsername = toSafeIdentifier(dbUsername, { maxLength: 32, fallback: "appuser" }).replace(
    /^[^a-zA-Z]+/,
    "u"
  );

  const args = {
    containerName,
    dbName: safeDbName,
    dbUsername: safeDbUsername,
    dbPassword,
    adminUsername,
    adminPassword,
  };

  if (type === "MYSQL") {
    await provisionMySQL({ ...args, rootPassword: adminPassword });
    return { dbName: safeDbName, dbUsername: safeDbUsername };
  }
  if (type === "POSTGRES") {
    await provisionPostgres(args);
    return { dbName: safeDbName, dbUsername: safeDbUsername };
  }
  if (type === "MONGODB") {
    await provisionMongo(args);
    return { dbName: safeDbName, dbUsername: safeDbUsername };
  }
  throw new Error(`Unsupported database type: ${type}`);
}

async function rotatePassword({
  type,
  containerName,
  dbName,
  dbUsername,
  newPassword,
  adminUsername,
  adminPassword,
}) {
  if (type === "MYSQL") {
    assertSafeUsername(dbUsername);
    await mysqlAdminExec(
      containerName,
      adminPassword,
      `ALTER USER '${dbUsername}'@'%' IDENTIFIED BY '${newPassword}'; FLUSH PRIVILEGES;`
    );
    return;
  }

  if (type === "POSTGRES") {
    assertSafeUsername(dbUsername);
    await postgresAdminExec(
      containerName,
      adminUsername,
      adminPassword,
      "postgres",
      `ALTER ROLE "${dbUsername}" WITH PASSWORD '${escapePgLiteral(newPassword)}';`
    );
    return;
  }

  if (type === "MONGODB") {
    assertSafeDbName(dbName);
    assertSafeUsername(dbUsername);
    const js = `
const dbName = ${JSON.stringify(dbName)};
const username = ${JSON.stringify(dbUsername)};
const pwd = ${JSON.stringify(newPassword)};
    const targetDb = db.getSiblingDB(dbName);
targetDb.updateUser(username, { pwd });
`.trim();
    await mongoAdminEval(containerName, adminUsername, adminPassword, js);
    return;
  }

  throw new Error(`Unsupported database type: ${type}`);
}

async function resetManagedDatabase({
  type,
  containerName,
  dbName,
  dbUsername,
  dbPassword,
  adminUsername,
  adminPassword,
}) {
  assertSafeDbName(dbName);
  assertSafeUsername(dbUsername);

  if (type === "MYSQL") {
    const sql = [
      `DROP DATABASE IF EXISTS \`${dbName}\`;`,
      `CREATE DATABASE \`${dbName}\`;`,
      `GRANT ALL PRIVILEGES ON \`${dbName}\`.* TO '${dbUsername}'@'%';`,
      "FLUSH PRIVILEGES;",
    ].join("\n");
    await mysqlAdminExec(containerName, adminPassword, sql);
    return;
  }

  if (type === "POSTGRES") {
    const dbLit = escapePgLiteral(dbName);
    await postgresAdminExec(
      containerName,
      adminUsername,
      adminPassword,
      "postgres",
      `
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${dbLit}'
  AND pid <> pg_backend_pid();
`.trim()
    );
    await postgresAdminExec(
      containerName,
      adminUsername,
      adminPassword,
      "postgres",
      `DROP DATABASE IF EXISTS "${dbName}";`
    );
    await provisionPostgres({
      containerName,
      dbName,
      dbUsername,
      dbPassword,
      adminUsername,
      adminPassword,
    });
    return;
  }

  if (type === "MONGODB") {
    const js = `
const dbName = ${JSON.stringify(dbName)};
db.getSiblingDB(dbName).dropDatabase();
`.trim();
    await mongoAdminEval(containerName, adminUsername, adminPassword, js);
    // Re-assert user/roles and password
    await provisionMongo({
      containerName,
      dbName,
      dbUsername,
      dbPassword,
      adminUsername,
      adminPassword,
    });
    return;
  }

  throw new Error(`Unsupported database type: ${type}`);
}

module.exports = {
  provisionManagedDatabase,
  rotatePassword,
  resetManagedDatabase,
};
