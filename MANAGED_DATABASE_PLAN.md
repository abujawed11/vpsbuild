# Managed Database Feature - Implementation Plan

## Overview

Add a managed database service to VPSBuilds platform, similar to Vercel Postgres, Railway DB, or Render Database. Users can create MySQL/PostgreSQL/MongoDB instances on-demand, manage them through a web interface, and connect them to their deployed applications.

---

## Architecture

### Key Design Decisions

1. **Separate Section** - Databases have their own dashboard section (not inside deployment wizard)
2. **1:1 Relationship** - Each project can link to ONE database (but databases can exist independently)
3. **Docker-based** - Each database runs in its own Docker container
4. **Same Network** - Databases run on `vpsbuilds_default` network for seamless connectivity
5. **Persistent Storage** - Use Docker volumes for data persistence
6. **Web Management** - Built-in query executor and table manager (like phpMyAdmin)

### Network Architecture

```
┌─────────────────────────────────────────────────┐
│         vpsbuilds_default Network               │
│                                                  │
│  ┌──────────────┐    ┌──────────────┐          │
│  │   Backend    │    │   Frontend   │          │
│  │  Container   │    │  Container   │          │
│  └──────────────┘    └──────────────┘          │
│                                                  │
│  ┌──────────────┐    ┌──────────────┐          │
│  │  User App 1  │───→│ db-proj1-xyz │          │
│  │  Container   │    │   (MySQL)    │          │
│  └──────────────┘    └──────────────┘          │
│                                                  │
│  ┌──────────────┐    ┌──────────────┐          │
│  │  User App 2  │───→│ db-proj2-abc │          │
│  │  Container   │    │  (Postgres)  │          │
│  └──────────────┘    └──────────────┘          │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Connection Flow:**
- User creates database → Docker container spawned
- Container name: `db-<slug>-<shortId>` (e.g., `db-myapp-7x9k`)
- Apps connect via: `mysql://user:pass@db-myapp-7x9k:3306/dbname`
- DNS resolved automatically by Docker

---

## Database Schema (Prisma)

### New Models

```prisma
model Database {
  id            String   @id @default(cuid())
  userId        String
  name          String   // User-friendly name (e.g., "My App Database")

  // Technical Details
  containerName String   @unique // Docker container name (e.g., "db-myapp-7x9k")
  type          DatabaseType // MYSQL, POSTGRES, MONGODB
  version       String   @default("8") // MySQL 8, Postgres 15, etc.

  // Database Credentials
  dbName        String   // Database name inside container
  username      String   // Database username
  password      String   // Encrypted password
  rootPassword  String   // Root/admin password (encrypted)

  // Connection Details
  host          String   // Container name (for internal connections)
  port          Int      // 3306 for MySQL, 5432 for Postgres, 27017 for MongoDB
  connectionUrl String   // Full connection string

  // Status & Metadata
  status        DatabaseStatus @default(CREATING)
  volumeName    String   // Docker volume name for persistence
  diskUsageMB   Int      @default(0) // Storage used in MB

  // Relationships
  projectId     String?  @unique // Optional link to project (1:1)
  project       Project? @relation(fields: [projectId], references: [id], onDelete: SetNull)

  // Timestamps
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  lastAccessedAt DateTime @default(now())

  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([userId, name])
  @@index([userId])
  @@index([status])
}

enum DatabaseType {
  MYSQL
  POSTGRES
  MONGODB
}

enum DatabaseStatus {
  CREATING
  RUNNING
  STOPPED
  FAILED
  DELETING
}

// Update Project model
model Project {
  // ... existing fields

  database      Database? // Optional 1:1 relationship
  databaseId    String?   @unique
}
```

---

## API Endpoints

### Database CRUD Operations

#### 1. Create Database
```
POST /api/databases
Body: {
  name: string,
  type: "MYSQL" | "POSTGRES" | "MONGODB",
  projectId?: string (optional - link to project)
}

Response: {
  success: true,
  database: {
    id: string,
    name: string,
    type: string,
    connectionUrl: string,
    username: string,
    password: string, // Only returned once!
    host: string,
    port: number,
    status: "CREATING"
  }
}
```

**Backend Logic:**
1. Generate secure credentials (username, password, root password)
2. Create Docker container with volume
3. Wait for container to be healthy
4. Create database record in Prisma
5. If projectId provided, link to project and add DATABASE_URL to env vars
6. Return credentials (password shown only once)

#### 2. List Databases
```
GET /api/databases

Response: {
  databases: [
    {
      id: string,
      name: string,
      type: string,
      status: string,
      diskUsageMB: number,
      createdAt: string,
      project: { id, name } | null,
      connectionUrl: string (masked password)
    }
  ]
}
```

#### 3. Get Database Details
```
GET /api/databases/:id

Response: {
  id: string,
  name: string,
  type: string,
  status: string,
  host: string,
  port: number,
  dbName: string,
  username: string,
  connectionUrl: string (masked),
  diskUsageMB: number,
  createdAt: string,
  lastAccessedAt: string,
  project: { id, name } | null
}
```

#### 4. Delete Database
```
DELETE /api/databases/:id

Response: {
  success: true,
  message: "Database deleted successfully"
}
```

**Backend Logic:**
1. Stop and remove Docker container
2. Remove Docker volume
3. If linked to project, remove DATABASE_URL from env vars
4. Delete database record

#### 5. Start/Stop/Restart Database
```
POST /api/databases/:id/start
POST /api/databases/:id/stop
POST /api/databases/:id/restart

Response: {
  success: true,
  status: "RUNNING" | "STOPPED"
}
```

#### 6. Link Database to Project
```
POST /api/databases/:id/link-project
Body: {
  projectId: string
}

Response: {
  success: true,
  message: "Database linked to project",
  envVarAdded: true
}
```

**Backend Logic:**
1. Check if project already has a database (prevent multiple)
2. Update project.databaseId
3. Add DATABASE_URL to project's env vars
4. Restart project container (for BACKEND type)

#### 7. Unlink Database from Project
```
POST /api/databases/:id/unlink-project

Response: {
  success: true,
  message: "Database unlinked from project"
}
```

### Database Management (Query Executor)

#### 8. Execute Query
```
POST /api/databases/:id/query
Body: {
  query: string,
  params?: any[] (for prepared statements)
}

Response: {
  success: true,
  results: any[],
  fields: { name, type }[],
  rowCount: number,
  executionTime: number (ms)
}

Error Response: {
  success: false,
  error: string,
  sqlState?: string
}
```

**Security:**
- Only allow SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP
- Block GRANT, REVOKE, CREATE USER, etc.
- Use prepared statements to prevent SQL injection
- Rate limit: max 10 queries per minute

#### 9. List Tables
```
GET /api/databases/:id/tables

Response: {
  tables: [
    {
      name: string,
      rowCount: number,
      sizeKB: number,
      engine: string (MySQL only),
      collation: string
    }
  ]
}
```

#### 10. Get Table Schema
```
GET /api/databases/:id/tables/:tableName

Response: {
  tableName: string,
  columns: [
    {
      name: string,
      type: string,
      nullable: boolean,
      default: any,
      key: "PRI" | "UNI" | "MUL" | null,
      extra: string (e.g., "auto_increment")
    }
  ],
  indexes: [
    {
      name: string,
      columns: string[],
      unique: boolean
    }
  ],
  rowCount: number
}
```

#### 11. Browse Table Data
```
GET /api/databases/:id/tables/:tableName/rows?page=1&limit=50

Response: {
  rows: any[],
  totalRows: number,
  page: number,
  limit: number,
  totalPages: number
}
```

#### 12. Get Database Stats
```
GET /api/databases/:id/stats

Response: {
  diskUsageMB: number,
  tableCount: number,
  totalRows: number,
  uptime: number (seconds),
  connections: number (active connections)
}
```

---

## UI/UX Design

### Main Navigation

Add new item to sidebar/header:
```
Dashboard
Projects
📊 Databases  ← NEW
Settings
```

### Databases Dashboard Page

**URL:** `/databases`

**Layout:**
```
┌────────────────────────────────────────────────┐
│  Databases                    [+ Create Database] │
├────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐  │
│  │  🗄️ My App Database                     │  │
│  │  MySQL 8.0 • Running • 45 MB             │  │
│  │  Linked to: my-app-project               │  │
│  │  Created: 2 days ago                     │  │
│  │                                           │  │
│  │  [Manage] [Query Editor] [⋮]             │  │
│  └─────────────────────────────────────────┘  │
│                                                 │
│  ┌─────────────────────────────────────────┐  │
│  │  🗄️ Test Database                        │  │
│  │  PostgreSQL 15 • Running • 12 MB         │  │
│  │  Not linked to any project               │  │
│  │  Created: 1 week ago                     │  │
│  │                                           │  │
│  │  [Manage] [Query Editor] [⋮]             │  │
│  └─────────────────────────────────────────┘  │
│                                                 │
│  Empty State (if no databases):               │
│  ┌─────────────────────────────────────────┐  │
│  │  📦 No databases yet                     │  │
│  │  Create your first managed database      │  │
│  │  [+ Create Database]                     │  │
│  └─────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

### Create Database Modal

**Triggered by:** "+ Create Database" button

```
┌──────────────────────────────────────────┐
│  Create Managed Database            [×]  │
├──────────────────────────────────────────┤
│                                           │
│  Database Name *                          │
│  [my-app-database        ]                │
│                                           │
│  Database Type *                          │
│  ○ MySQL 8.0                              │
│  ○ PostgreSQL 15                          │
│  ○ MongoDB 7                              │
│                                           │
│  Link to Project (Optional)               │
│  [Select Project ▼]                       │
│  ├─ my-app-project                        │
│  ├─ blog-site                             │
│  └─ (None)                                │
│                                           │
│  ℹ️ Advanced Settings (collapsed)         │
│                                           │
│  [Cancel]              [Create Database]  │
└──────────────────────────────────────────┘
```

**Advanced Settings (collapsed by default):**
```
│  Database Name (inside container)         │
│  [myapp_db               ]                │
│                                           │
│  Username                                 │
│  [admin                  ]                │
│                                           │
│  Password (auto-generated)                │
│  [•••••••••••••••]  [🔄 Regenerate]      │
│                                           │
│  Port                                     │
│  [3306                   ]                │
```

**After Creation Success:**
```
┌──────────────────────────────────────────┐
│  ✅ Database Created Successfully!   [×] │
├──────────────────────────────────────────┤
│                                           │
│  ⚠️ Save these credentials now!          │
│  You won't be able to see the password   │
│  again after closing this window.        │
│                                           │
│  Connection URL:                          │
│  [mysql://admin:x7k9...@db-myapp-7x9k:... │
│   3306/myapp_db                     ] 📋  │
│                                           │
│  Host: db-myapp-7x9k                      │
│  Port: 3306                               │
│  Database: myapp_db                       │
│  Username: admin                          │
│  Password: x7k9mP2vQ8nL                   │
│                                           │
│  [Download as .env]   [Copy All] [Done]  │
└──────────────────────────────────────────┘
```

### Database Management Page

**URL:** `/databases/:id`

**Layout with Tabs:**
```
┌────────────────────────────────────────────────┐
│  ← Back to Databases                            │
│                                                 │
│  🗄️ My App Database                            │
│  MySQL 8.0 • Running • 45 MB                    │
├────────────────────────────────────────────────┤
│  [Overview] [Query Editor] [Tables] [Settings] │
├────────────────────────────────────────────────┤
│                                                 │
│  CURRENT TAB CONTENT HERE                       │
│                                                 │
└────────────────────────────────────────────────┘
```

#### Tab 1: Overview
```
│  Connection Details                             │
│  ┌──────────────────────────────────────────┐  │
│  │  Host: db-myapp-7x9k            [📋]     │  │
│  │  Port: 3306                     [📋]     │  │
│  │  Database: myapp_db             [📋]     │  │
│  │  Username: admin                [📋]     │  │
│  │  Connection URL: mysql://...    [📋]     │  │
│  │                                           │  │
│  │  ⚠️ Password is hidden for security      │  │
│  │  [Reset Password]                        │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Statistics                                     │
│  ┌──────────────────────────────────────────┐  │
│  │  📊 Disk Usage: 45 MB / 10 GB            │  │
│  │  📋 Tables: 12                            │  │
│  │  📈 Total Rows: 45,821                    │  │
│  │  🔌 Active Connections: 2                 │  │
│  │  ⏱️ Uptime: 3 days 14 hours              │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Linked Project                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  🔗 my-app-project                        │  │
│  │  DATABASE_URL has been added to env vars │  │
│  │  [View Project] [Unlink]                  │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Or link to a different project:               │
│  [Select Project ▼] [Link]                     │
```

#### Tab 2: Query Editor
```
│  SQL Query Editor                               │
│  ┌──────────────────────────────────────────┐  │
│  │  1  SELECT * FROM users                   │  │
│  │  2  WHERE created_at > '2025-01-01'       │  │
│  │  3  LIMIT 10;                             │  │
│  │  4                                         │  │
│  │  5                                         │  │
│  │                                           │  │
│  └──────────────────────────────────────────┘  │
│  [Run Query] [Clear] [Format SQL]              │
│                                                 │
│  Results                                        │
│  ┌──────────────────────────────────────────┐  │
│  │  ✅ Query executed in 12ms (10 rows)     │  │
│  │                                           │  │
│  │  ┌───┬─────────┬───────┬────────────┐   │  │
│  │  │id │ name    │ email │ created_at │   │  │
│  │  ├───┼─────────┼───────┼────────────┤   │  │
│  │  │ 1 │ John    │ j@... │ 2025-01-05 │   │  │
│  │  │ 2 │ Jane    │ j@... │ 2025-01-06 │   │  │
│  │  └───┴─────────┴───────┴────────────┘   │  │
│  │                                           │  │
│  │  [Export CSV] [Export JSON]               │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  Query History                                  │
│  ┌──────────────────────────────────────────┐  │
│  │  SELECT * FROM users LIMIT 10  (2m ago)  │  │
│  │  CREATE TABLE products ...     (5m ago)  │  │
│  └──────────────────────────────────────────┘  │
```

**Query Editor Features:**
- Syntax highlighting (CodeMirror or Monaco Editor)
- Auto-complete for table/column names
- Run query with Ctrl+Enter
- Show execution time and row count
- Export results as CSV/JSON
- Query history (last 10 queries)
- Error highlighting with helpful messages

#### Tab 3: Tables
```
│  Tables (12)                       [🔄 Refresh] │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  📋 users                                 │  │
│  │  1,245 rows • 2.3 MB                      │  │
│  │  [Browse] [Structure] [Drop]              │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  📋 posts                                 │  │
│  │  3,821 rows • 8.7 MB                      │  │
│  │  [Browse] [Structure] [Drop]              │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  ┌──────────────────────────────────────────┐  │
│  │  📋 comments                              │  │
│  │  15,234 rows • 12.1 MB                    │  │
│  │  [Browse] [Structure] [Drop]              │  │
│  └──────────────────────────────────────────┘  │
│                                                 │
│  [+ Create Table]                              │
```

**Browse Table Modal:**
```
┌──────────────────────────────────────────┐
│  Browse Table: users              [×]    │
├──────────────────────────────────────────┤
│  [Search] [Filter] [Add Row]             │
│                                           │
│  ┌───┬─────────┬──────────┬──────────┐  │
│  │id │ name    │ email    │ created  │  │
│  ├───┼─────────┼──────────┼──────────┤  │
│  │ 1 │ John    │ j@ex.com │ 2025-... │  │
│  │ 2 │ Jane    │ jane@... │ 2025-... │  │
│  └───┴─────────┴──────────┴──────────┘  │
│                                           │
│  Page 1 of 25   [←] [→]    50 per page  │
└──────────────────────────────────────────┘
```

**Table Structure Modal:**
```
┌──────────────────────────────────────────┐
│  Table Structure: users           [×]    │
├──────────────────────────────────────────┤
│  Columns                                  │
│  ┌────────────────────────────────────┐  │
│  │ Column      Type         Null Key  │  │
│  ├────────────────────────────────────┤  │
│  │ id          int(11)      NO   PRI  │  │
│  │ name        varchar(255) YES       │  │
│  │ email       varchar(255) YES  UNI  │  │
│  │ created_at  datetime     YES       │  │
│  └────────────────────────────────────┘  │
│                                           │
│  Indexes                                  │
│  ┌────────────────────────────────────┐  │
│  │ PRIMARY KEY (id)                   │  │
│  │ UNIQUE KEY email_idx (email)       │  │
│  └────────────────────────────────────┘  │
│                                           │
│  [Alter Table] [Copy CREATE Statement]  │
└──────────────────────────────────────────┘
```

#### Tab 4: Settings
```
│  Database Settings                              │
│                                                 │
│  Name                                           │
│  [My App Database            ] [Update]         │
│                                                 │
│  Status                                         │
│  🟢 Running                                     │
│  [Stop Database] [Restart Database]            │
│                                                 │
│  Security                                       │
│  [🔄 Reset Password]                            │
│  [📥 Download Backup]                           │
│  [📤 Restore from Backup]                       │
│                                                 │
│  Danger Zone                                    │
│  ┌──────────────────────────────────────────┐  │
│  │  [🗑️ Delete Database]                    │  │
│  │  This action cannot be undone.            │  │
│  └──────────────────────────────────────────┘  │
```

### Database Option in Project Dropdown

Update the three-dots menu in GroupView.jsx:
```
📂 Manage Files
⚙️ Edit Environment Variables
🗄️ Database  ← NEW (opens database selection modal)
🚀 Redeploy
🗑️ Delete
```

**Database Modal for Project:**
```
┌──────────────────────────────────────────┐
│  Database for my-app-project      [×]    │
├──────────────────────────────────────────┤
│                                           │
│  Current Database:                        │
│  ┌──────────────────────────────────────┐│
│  │  🗄️ My App Database (MySQL 8)        ││
│  │  45 MB • Running                      ││
│  │  [Manage] [Unlink]                    ││
│  └──────────────────────────────────────┘│
│                                           │
│  Or link a different database:            │
│  [Select Database ▼]                      │
│  ├─ Test Database (PostgreSQL)            │
│  └─ (Create new database)  ← opens modal │
│                                           │
│  [Link Database]                          │
└──────────────────────────────────────────┘
```

---

## Implementation Steps

### Phase 1: Backend Foundation (Week 1)

**Day 1-2: Database Schema & Models**
- [ ] Update Prisma schema with Database model
- [ ] Run migrations: `npx prisma migrate dev`
- [ ] Test relationships (User → Database, Project ↔ Database)

**Day 3-4: Docker Management Functions**
- [ ] Create `vps-back/src/lib/database-manager.js`
  - `createDatabaseContainer(type, config)` - Create MySQL/Postgres/MongoDB container
  - `stopDatabase(containerName)` - Stop container
  - `startDatabase(containerName)` - Start container
  - `deleteDatabase(containerName, volumeName)` - Remove container + volume
  - `getDatabaseStats(containerName)` - Get disk usage, uptime, connections
  - `executeDatabaseQuery(containerName, query, params)` - Run SQL query
- [ ] Test container lifecycle (create → start → stop → delete)

**Day 5: API Endpoints - CRUD**
- [ ] POST `/api/databases` - Create database
- [ ] GET `/api/databases` - List user's databases
- [ ] GET `/api/databases/:id` - Get database details
- [ ] DELETE `/api/databases/:id` - Delete database
- [ ] POST `/api/databases/:id/start|stop|restart`

**Day 6-7: API Endpoints - Management**
- [ ] POST `/api/databases/:id/link-project` - Link to project
- [ ] POST `/api/databases/:id/unlink-project` - Unlink from project
- [ ] GET `/api/databases/:id/stats` - Database statistics
- [ ] POST `/api/databases/:id/reset-password` - Generate new password

### Phase 2: Query Editor & Table Management (Week 2)

**Day 1-3: Query Executor**
- [ ] POST `/api/databases/:id/query` - Execute SQL query
  - Implement connection pooling
  - Add query validation (block dangerous queries)
  - Add rate limiting (max 10/minute)
  - Support both MySQL and PostgreSQL syntax
- [ ] GET `/api/databases/:id/tables` - List all tables
- [ ] GET `/api/databases/:id/tables/:name` - Get table schema
- [ ] GET `/api/databases/:id/tables/:name/rows` - Browse table data (paginated)

**Day 4-7: Frontend - Database Dashboard**
- [ ] Create `vps-front/src/pages/DatabasesDashboard.jsx`
  - List all databases (cards with status, size, linked project)
  - Empty state
  - Create database button
- [ ] Create `vps-front/src/components/CreateDatabaseModal.jsx`
  - Form: name, type, project link
  - Advanced settings (collapsed)
  - Success modal with credentials (copy buttons)
- [ ] Create `vps-front/src/components/DatabaseCard.jsx`
  - Show name, type, status badge, disk usage
  - Actions: Manage, Query Editor, dropdown (start/stop/delete)

### Phase 3: Database Management UI (Week 3)

**Day 1-3: Management Page - Overview Tab**
- [ ] Create `vps-front/src/pages/DatabaseManagementPage.jsx`
  - Tab navigation (Overview, Query Editor, Tables, Settings)
- [ ] Overview Tab:
  - Connection details (with copy buttons)
  - Statistics (disk usage, table count, rows, connections, uptime)
  - Linked project card (with unlink button)
  - Link to project dropdown

**Day 4-5: Query Editor Tab**
- [ ] Install code editor: `npm install @monaco-editor/react`
- [ ] Create query editor component:
  - Syntax highlighting
  - Run query button (Ctrl+Enter)
  - Results table with pagination
  - Export CSV/JSON
  - Query history (last 10)
  - Error display

**Day 6-7: Tables Tab**
- [ ] List tables with row count and size
- [ ] Create `BrowseTableModal.jsx`:
  - Paginated data table
  - Search and filter
  - Edit/delete rows (optional)
- [ ] Create `TableStructureModal.jsx`:
  - Show columns (name, type, nullable, key, extra)
  - Show indexes
  - Copy CREATE TABLE statement

### Phase 4: Integration & Polish (Week 4)

**Day 1-2: Project Integration**
- [ ] Add "Database" option to project dropdown menu
- [ ] Create `DatabaseLinkModal.jsx` for projects
  - Show currently linked database
  - Option to link different database or create new
  - Auto-add DATABASE_URL to env vars

**Day 3-4: Settings Tab**
- [ ] Update database name
- [ ] Start/Stop/Restart controls
- [ ] Reset password (generate new + update container)
- [ ] Delete database (with confirmation)

**Day 5: Testing**
- [ ] Test MySQL container creation and query execution
- [ ] Test PostgreSQL container creation and query execution
- [ ] Test linking database to project (env var injection)
- [ ] Test container restart with new credentials
- [ ] Test database deletion (container + volume cleanup)

**Day 6-7: Documentation & Deployment**
- [ ] Update README with database feature
- [ ] Create user guide: "How to use Managed Databases"
- [ ] Add tooltips and help text in UI
- [ ] Deploy to production

---

## Security Considerations

### Password Storage
- **Encrypt passwords** in database using `crypto` or bcrypt
- Never log passwords in deployment logs
- Show password only once after creation (like SSH keys)

### Query Execution
- **Whitelist allowed SQL commands**: SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP
- **Block admin commands**: GRANT, REVOKE, CREATE USER, SET PASSWORD, FLUSH
- **Use prepared statements** to prevent SQL injection
- **Rate limit**: Max 10 queries per minute per database
- **Timeout**: Kill queries running longer than 30 seconds

### Network Security
- Databases only accessible within Docker network (no public exposure)
- No direct external connections (must go through backend API)
- Each database in isolated container

### Authentication
- All API endpoints require `authRequired` middleware
- Verify `userId` matches database owner before any operation
- No cross-user database access

---

## Docker Commands Reference

### MySQL Container
```bash
docker run -d \
  --name db-myapp-7x9k \
  --network vpsbuilds_default \
  -e MYSQL_ROOT_PASSWORD=rootpass123 \
  -e MYSQL_DATABASE=myapp_db \
  -e MYSQL_USER=admin \
  -e MYSQL_PASSWORD=userpass123 \
  -v db-myapp-7x9k-data:/var/lib/mysql \
  --restart unless-stopped \
  mysql:8.0
```

### PostgreSQL Container
```bash
docker run -d \
  --name db-myapp-7x9k \
  --network vpsbuilds_default \
  -e POSTGRES_DB=myapp_db \
  -e POSTGRES_USER=admin \
  -e POSTGRES_PASSWORD=userpass123 \
  -v db-myapp-7x9k-data:/var/lib/postgresql/data \
  --restart unless-stopped \
  postgres:15-alpine
```

### MongoDB Container
```bash
docker run -d \
  --name db-myapp-7x9k \
  --network vpsbuilds_default \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=userpass123 \
  -e MONGO_INITDB_DATABASE=myapp_db \
  -v db-myapp-7x9k-data:/data/db \
  --restart unless-stopped \
  mongo:7
```

### Get Container Stats
```bash
# Disk usage
docker exec db-myapp-7x9k du -sh /var/lib/mysql

# MySQL stats
docker exec db-myapp-7x9k mysql -uroot -p<pass> -e "SHOW STATUS LIKE 'Uptime'; SHOW STATUS LIKE 'Threads_connected';"

# Postgres stats
docker exec db-myapp-7x9k psql -U admin -c "SELECT pg_database_size('myapp_db');"
```

---

## Technology Stack

### Backend
- **Node.js** - Server runtime
- **Prisma** - ORM for database management
- **mysql2** - MySQL client for query execution
- **pg** - PostgreSQL client
- **mongodb** - MongoDB client (optional, for MongoDB support)
- **Docker SDK** - Container management via shell commands

### Frontend
- **React** - UI framework
- **Monaco Editor** (or CodeMirror) - SQL query editor with syntax highlighting
- **React Table** (or TanStack Table) - Data tables for query results
- **Recharts** - Charts for database statistics

---

## Future Enhancements (Phase 2)

### Backups & Restore
- Scheduled automatic backups (daily/weekly)
- Download backup as SQL dump
- Restore from backup file
- Point-in-time recovery

### Monitoring & Alerts
- Real-time query monitoring
- Slow query log
- Connection pool metrics
- Disk usage alerts (email when >80%)

### Advanced Features
- Read replicas (for high-traffic apps)
- Database cloning (copy database to new instance)
- Import from external database (migration tool)
- Database branching (like Neon.tech)

### Collaboration
- Share database access with team members
- Read-only access mode
- Query sharing (save and share SQL queries)

---

## Cost Estimation (for pricing model)

### Per Database Costs:
- **Storage**: ~$0.10/GB/month (SSD storage)
- **Compute**: Minimal (containers share host resources)
- **Backups**: ~$0.05/GB/month

### Suggested Pricing:
- **Free Tier**: 1 database, 1GB storage, 1GB backup
- **Pro Tier ($10/month)**: 5 databases, 10GB storage each, 5GB backups
- **Business Tier ($50/month)**: Unlimited databases, 50GB storage each, 25GB backups

---

## Success Metrics

### User Adoption
- % of projects with linked databases
- Databases created per user
- Query editor usage (queries per week)

### Performance
- Database creation time (target: <30 seconds)
- Query execution time (target: <200ms average)
- Container resource usage (CPU/memory)

### Reliability
- Database uptime (target: 99.9%)
- Failed query rate (target: <0.1%)
- Data loss incidents (target: 0)

---

## Conclusion

This managed database feature will:
✅ Solve the current MySQL connection issues
✅ Provide a seamless developer experience (no manual DB setup)
✅ Differentiate VPSBuilds from competitors
✅ Create a new revenue stream (paid tiers)
✅ Enable users to build full-stack applications easily

**Estimated Development Time:** 3-4 weeks (1 developer, full-time)

**Priority:** HIGH - Core feature for any modern deployment platform




Perfect! I've created a comprehensive 36-page implementation plan for the Managed Database feature at D:\react\vpsbuilds\MANAGED_DATABASE_PLAN.md.

  What's Included:                                                                                                                                                                      
  📋 Complete Architecture                                                                                                                                                           
  
  - Network diagram showing how databases connect
  - Docker-based isolation
  - Same network connectivity

  💾 Database Schema

  - Full Prisma models for Database management
  - 1:1 project relationship (optional linking)
  - Status tracking, credentials, metadata

  🔌 API Endpoints (12 endpoints)

  - CRUD operations (create, list, delete, start/stop)
  - Query executor (run SQL queries)
  - Table browser (list tables, view schema, browse data)
  - Link/unlink to projects

  🎨 UI/UX Design

  - Separate "Databases" section in main navigation (not in wizard)
  - Database dashboard with cards
  - Full management page with 4 tabs:
    - Overview - Connection details, stats, linked project
    - Query Editor - Run SQL queries with syntax highlighting (like phpMyAdmin)
    - Tables - Browse tables, view structure, create/drop tables
    - Settings - Name, start/stop, reset password, delete
  - Project integration (database option in dropdown menu)

  📅 Implementation Timeline

  - Week 1: Backend foundation (schema, Docker, API CRUD)
  - Week 2: Query editor & table management APIs
  - Week 3: Frontend UI (dashboard, query editor, table browser)
  - Week 4: Integration, testing, deployment

  🔒 Security

  - Password encryption
  - SQL injection prevention
  - Query whitelisting (block dangerous commands)
  - Rate limiting
  - Network isolation

  🚀 Future Enhancements

  - Backups & restore
  - Monitoring & alerts
  - Database cloning
  - Team collaboration

  ---
  Key Features You Wanted:

  ✅ Separate section (like "Create New Site")
  ✅ Create tables (via Tables tab)
  ✅ Execute queries (via Query Editor tab with syntax highlighting)
  ✅ Browse data (paginated table viewer)
  ✅ Link to projects (optional, auto-injects DATABASE_URL)

  ---
  This solves your MySQL connection issue permanently! Users won't need external databases - everything is managed within your platform.

  Ready to start implementing? Want me to begin with Phase 1 (backend foundation)? 🚀