# VPSBuilds Project Restructure Plan

---

## 📊 Progress Summary

| Phase | Status | Description |
|-------|--------|-------------|
| **Phase 1** | ✅ COMPLETED | Schema & Backend Updates |
| **Phase 2** | ⏳ NOT STARTED | Frontend Updates |
| **Phase 2.5** | 🔄 PARTIAL | File Management (Backend done, Frontend pending) |
| **Phase 3** | ⏳ NOT STARTED | Nginx & Routing |
| **Phase 4** | ⏳ NOT STARTED | Testing & Migration |

### What's Done (Phase 1)
- ✅ Prisma schema updated (slug, apiPathPrefix, role, groupId)
- ✅ Groups routes updated (slug generation, PATCH, GET single)
- ✅ Projects routes updated (role handling, container naming)
- ✅ Databases routes updated (groupId linking)
- ✅ Nginx config generator rewritten (path-based routing)
- ✅ Files routes created (upload/list/delete)
- ✅ Dockerfile updated (auto prisma db push)

### What's Left
- ⏳ Frontend UI redesign (Dashboard, ProjectView, Cards)
- ⏳ File Manager component (frontend)
- ⏳ Deployments route updates
- ⏳ Testing all scenarios

---

## Overview

This document outlines the complete restructuring of VPSBuilds from a "multiple sites per project group" model to a "one project = one subdomain with frontend + backend + database" model.

---

## Current Architecture (Before)

### Data Model
```
User
├── ProjectGroup (folder/container)
│   ├── Project 1 (site) → slug1.domain.com
│   ├── Project 2 (site) → slug2.domain.com
│   └── Project N (site) → slugN.domain.com
└── Database (separate, user-level)
    ├── Database 1
    └── Database 2
```

### Current Problems
1. **CORS Issues**: Frontend and backend deployed as separate sites with different subdomains
2. **Confusing UX**: Users must manually name each site, manage CORS, configure API URLs
3. **Database Isolation**: Databases are user-level, not project-level
4. **No Unified Routing**: Each site gets its own nginx config, no path-based routing

### Current Pages
- `/dashboard` - Shows project groups + "Databases" button in nav
- `/databases` - Separate page to manage all databases
- `/groups/:id` - Shows list of sites in a group (unlimited sites)

---

## New Architecture (After)

### Data Model
```
User
└── Project (was ProjectGroup)
    ├── name: string
    ├── slug: string (becomes subdomain)
    ├── apiPathPrefix: string (default: "/api", configurable)
    ├── Frontend: Project? (role=FRONTEND, max 1)
    ├── Backend: Project? (role=BACKEND, max 1)
    └── Database: Database? (max 1)
```

### URL Structure (Single Subdomain)
```
Project: "bomf"
Subdomain: bomf.93.127.199.118.sslip.io

Routes:
├── /              → Frontend container (static files)
├── /api/*         → Backend container (configurable prefix)
├── /uploads/*     → Nginx serves directly (VPSBuild-managed folder)
├── /media/*       → Nginx serves directly (VPSBuild-managed folder)
└── Database       → Internal only (bomf-db:3306)
```

### Static Files Convention (VPSBuild-Managed)

VPSBuild manages user uploads through the dashboard - NOT through user's backend code.

| Folder | URL Path | Purpose | Managed By |
|--------|----------|---------|------------|
| `/uploads/` | `/uploads/*` | User-uploaded images/files | VPSBuild Dashboard |
| `/media/` | `/media/*` | Media files (videos, etc.) | VPSBuild Dashboard |

**Key Points:**
1. Users upload files through VPSBuild dashboard file manager
2. Nginx serves these files directly (fast, no backend proxy needed)
3. Files stored at: `/var/www/{slug}/uploads/` and `/var/www/{slug}/media/`
4. Users access files at: `https://{slug}.domain.com/uploads/filename.png`
5. User's backend code does NOT need to handle these - VPSBuild manages everything

**Why this approach:**
- Simple: Users don't configure Express routes
- Fast: Nginx serves static files directly
- Consistent: Every project works the same way
- No conflicts: Reserved paths never clash with frontend assets

### Benefits
1. **No CORS**: Same subdomain = same origin, no CORS configuration needed
2. **Simple UX**: One project, one URL, clear structure
3. **Project-Scoped DB**: Database belongs to project, easy to link
4. **Professional**: Similar to Vercel, Railway, Render architecture

---

## UI Design

### Dashboard (Main Page)
```
┌──────────────────────────────────────────────────────────────┐
│  My Projects                              [+ New Project]    │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐  ┌─────────────────────┐           │
│  │ BOM Manager         │  │ Portfolio            │           │
│  │ bomf.domain.com     │  │ portfolio.domain.com │           │
│  │                     │  │                      │           │
│  │ 🌐 ✅  ⚙️ ✅  🗄️ ✅ │  │ 🌐 ✅  ⚙️ ❌  🗄️ ❌  │           │
│  │ FE    BE    DB      │  │ FE    BE    DB       │           │
│  └─────────────────────┘  └─────────────────────┘           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### Project View (Inside a Project)
```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Dashboard                                            │
│                                                                 │
│  Project: BOM Manager                                           │
│  URL: bomf.93.127.199.118.sslip.io                             │
│  API Prefix: /api  [Edit]                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────┐ ┌───────────────────┐ ┌────────────────┐│
│  │   🌐 FRONTEND     │ │   ⚙️ BACKEND      │ │  🗄️ DATABASE   ││
│  │                   │ │                   │ │                ││
│  │   ✅ DEPLOYED     │ │   ✅ RUNNING      │ │  ✅ RUNNING    ││
│  │   React + Vite    │ │   Node.js/Express │ │  MySQL 8.0     ││
│  │                   │ │   Port: 3000      │ │  bomf_db       ││
│  │                   │ │                   │ │                ││
│  │  ┌─────┐ ┌───┐   │ │  ┌─────┐ ┌───┐   │ │ ┌─────┐ ┌───┐  ││
│  │  │Manage│ │ ⋮ │   │ │  │Manage│ │ ⋮ │   │ │ │Manage│ │ ⋮ │  ││
│  │  └─────┘ └───┘   │ │  └─────┘ └───┘   │ │ └─────┘ └───┘  ││
│  └───────────────────┘ └───────────────────┘ └────────────────┘│
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Card shows [+ Add Frontend] button if not added                │
│  Card shows [+ Add Backend] button if not added                 │
│  Card shows [+ Add Database] button if not added                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3-Dot Menu Options (per card)
- **Frontend**: Manage Files, Edit Env Vars, Redeploy, Delete
- **Backend**: Manage Files, Edit Env Vars, Execute Script, Redeploy, Delete
- **Database**: View Connection, Query Editor, Tables, Delete

---

## Database Schema Changes

### Current Schema (Relevant Parts)
```prisma
model ProjectGroup {
  id        String    @id @default(cuid())
  userId    String
  name      String
  projects  Project[]
  user      User      @relation(fields: [userId], references: [id])

  @@unique([userId, name])
}

model Project {
  id          String   @id @default(cuid())
  userId      String
  groupId     String?
  name        String
  slug        String   @unique
  deployType  DeployType?  // FRONTEND, BACKEND, FULLSTACK
  // ... other fields

  group       ProjectGroup? @relation(fields: [groupId], references: [id])
}

model Database {
  id        String   @id @default(cuid())
  userId    String
  name      String
  projectId String?  @unique  // Optional link to project
  // ... other fields
}
```

### New Schema
```prisma
// Rename ProjectGroup to Project (conceptually)
// Or keep ProjectGroup but rename in UI to "Project"

model ProjectGroup {
  id            String    @id @default(cuid())
  userId        String
  name          String
  slug          String    @unique  // ADD: This becomes the subdomain
  apiPathPrefix String    @default("/api")  // ADD: Configurable API route prefix

  // Relations (max 1 each)
  frontend      Project?  @relation("Frontend")
  backend       Project?  @relation("Backend")
  database      Database?

  user          User      @relation(fields: [userId], references: [id])
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@unique([userId, name])
}

model Project {
  id          String      @id @default(cuid())
  userId      String
  groupId     String      // Required now
  role        ProjectRole // ADD: FRONTEND or BACKEND

  // Remove: name, slug (use parent ProjectGroup's slug)
  // Keep all deployment-related fields
  deployType  DeployType?
  // ... other fields

  group       ProjectGroup @relation(fields: [groupId], references: [id])

  @@unique([groupId, role])  // One frontend + one backend per group
}

enum ProjectRole {
  FRONTEND
  BACKEND
}

model Database {
  id        String       @id @default(cuid())
  userId    String
  groupId   String       @unique  // CHANGE: Required, unique per group
  name      String       // Auto-generated from group slug
  // ... other fields

  group     ProjectGroup @relation(fields: [groupId], references: [id])
}
```

---

## Implementation Tasks

### Phase 1: Schema & Backend Updates ✅ COMPLETED

#### 1.1 Update Prisma Schema ✅
- [x] Add `slug` and `apiPathPrefix` to ProjectGroup
- [x] Add `role` enum (FRONTEND/BACKEND) to Project
- [x] Update Project to have optional `role` field (for backward compatibility)
- [x] Update Database to have optional `groupId` (for backward compatibility)
- [x] Add unique constraint `@@unique([groupId, role])` to Project
- [x] Run `prisma db push` to apply changes

#### 1.2 Update Backend Routes ✅

**Groups Route (`/api/groups`):** ✅
- [x] Update POST `/groups` to generate slug from name
- [x] Add PATCH `/groups/:id` to update apiPathPrefix
- [x] Update GET `/groups` to include frontend/backend/database status
- [x] Add GET `/groups/:id` for single group with full details

**Projects Route (`/api/projects`):** ✅
- [x] Update POST `/projects` to accept `role` instead of custom name
- [x] Auto-generate slug from parent group: `{groupSlug}` for both FE/BE containers
- [x] Container naming: `{groupSlug}-frontend`, `{groupSlug}-backend`
- [x] Remove ability to create multiple projects of same role in a group

**Database Route (`/api/databases`):** ✅
- [x] Update POST `/databases` to accept `groupId`
- [x] Auto-name database container: `{groupSlug}-db`
- [x] Enforce one database per group
- [x] Standalone database creation still allowed (backward compatibility)

#### 1.3 Update Nginx Config Generator ✅
- [x] Generate ONE config per ProjectGroup (not per Project)
- [x] Route structure:
  ```nginx
  server {
      server_name {slug}.{domain};

      # Root for VPSBuild-managed static files
      root /var/www/{slug};

      # VPSBuild-managed uploads - served directly by Nginx (fast!)
      location /uploads/ {
          alias /var/www/{slug}/uploads/;
          expires 30d;
          add_header Cache-Control "public, immutable";
      }

      # VPSBuild-managed media - served directly by Nginx
      location /media/ {
          alias /var/www/{slug}/media/;
          expires 30d;
          add_header Cache-Control "public, immutable";
      }

      # API routes → Backend container
      location /{apiPathPrefix}/ {
          proxy_pass http://{slug}-backend:{port}/;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }

      # Frontend SPA → Frontend container
      location / {
          proxy_pass http://{slug}-frontend:80/;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
      }
  }
  ```
- [x] Handle cases: only frontend, only backend, both
- [x] Update on any component add/remove
- [x] Always include `/uploads/` and `/media/` locations (VPSBuild-managed)
- [x] Added legacy function for backward compatibility

### Phase 2: Frontend Updates

#### 2.1 Remove /databases Page
- [ ] Delete `vps-front/src/pages/Databases.jsx`
- [ ] Remove route from `App.jsx`
- [ ] Remove "Databases" button from Dashboard nav

#### 2.2 Update Dashboard
- [ ] Show FE/BE/DB status indicators on each project card
- [ ] Format: `🌐 ✅  ⚙️ ❌  🗄️ ✅` (icons with check/cross)
- [ ] Remove any "Databases" navigation

#### 2.3 Redesign GroupView → ProjectView
- [ ] Rename component to `ProjectView.jsx`
- [ ] Replace sites list with 3-card layout:
  - Frontend Card
  - Backend Card
  - Database Card
- [ ] Each card shows:
  - Status (Not Added / Deploying / Deployed / Running / Error)
  - Type info (React, Node.js, MySQL, etc.)
  - Action buttons (Add / Manage / 3-dot menu)
- [ ] Show project URL and API prefix at top
- [ ] Add "Edit API Prefix" option

#### 2.4 Update Deployment Wizard
- [ ] Remove "Site Name" input step
- [ ] Auto-use project slug for container naming
- [ ] Add role selection if needed (or infer from deployType)
- [ ] Simplify flow: Select Source → Configure → Deploy

#### 2.5 Move Database Creation
- [ ] Create `AddDatabaseCard.jsx` component
- [ ] Integrate `CreateDatabaseModal` into ProjectView
- [ ] Auto-name database from project slug
- [ ] Disable "Add Database" if one exists

#### 2.6 Update Card Components
- [ ] Create `FrontendCard.jsx`
- [ ] Create `BackendCard.jsx`
- [ ] Create `DatabaseCard.jsx`
- [ ] Each card handles its own state and actions

### Phase 2.5: File Management (VPSBuild-Managed Uploads)

#### 2.7 Create File Manager Component
- [ ] Create `FileManager.jsx` component for uploads/media management
- [ ] Two tabs: "Uploads" and "Media"
- [ ] Features:
  - Upload files (drag & drop + click to select)
  - List files with thumbnails (images) or icons (other files)
  - Copy URL to clipboard
  - Delete files
  - Create subfolders (optional)

#### 2.8 File Manager UI Design
```
┌─────────────────────────────────────────────────────────────────┐
│  📁 Files                                                        │
├─────────────────────────────────────────────────────────────────┤
│  [Uploads]  [Media]                         [Upload Files ↑]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  🖼️      │ │  🖼️      │ │  📄      │ │  🎬      │           │
│  │ logo.png │ │banner.jpg│ │ doc.pdf  │ │intro.mp4 │           │
│  │  [Copy]  │ │  [Copy]  │ │  [Copy]  │ │  [Copy]  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  ℹ️ Access your files at:                                       │
│     https://bomf.domain.com/uploads/logo.png                   │
│     https://bomf.domain.com/media/intro.mp4                    │
└─────────────────────────────────────────────────────────────────┘
```

#### 2.9 Backend File Upload Routes ✅ COMPLETED
- [x] POST `/api/files/:groupId/upload` - Upload file(s)
  - Accept: multipart/form-data
  - Query param: `folder=uploads|media`
  - Saves to: `/var/www/{slug}/{folder}/`
- [x] GET `/api/files/:groupId` - List files
  - Query param: `folder=uploads|media`
- [x] DELETE `/api/files/:groupId/:filename` - Delete file
  - Query param: `folder=uploads|media`
- [x] Create folders on project creation: `uploads/` and `media/`
- [x] Added route to `index.js`: `/api/files`

#### 2.10 File Storage Structure
```
/var/www/{slug}/
├── uploads/           ← User-uploaded images/files
│   ├── logo.png
│   ├── banner.jpg
│   └── documents/
│       └── brochure.pdf
├── media/             ← Media files (videos, audio)
│   └── intro.mp4
├── frontend/          ← Frontend container files (if any)
└── backend/           ← Backend container files (if any)
```

### Phase 3: Nginx & Routing

#### 3.1 Unified Nginx Config
- [ ] One `.conf` file per project: `{slug}.conf`
- [ ] Dynamic routing based on what's deployed:
  - Only Frontend: `/` → frontend container
  - Only Backend: `/` → backend container, `/{prefix}/*` → backend
  - Both: `/` → frontend, `/{prefix}/*` → backend

#### 3.2 Container Naming Convention
```
Project: "bomf"
├── Frontend container: bomf-frontend
├── Backend container:  bomf-backend
└── Database container: bomf-db
```

#### 3.3 Network Configuration
- [ ] All containers on same Docker network
- [ ] Internal DNS resolution for DB connections
- [ ] Database URL format: `mysql://user:pass@{slug}-db:3306/{dbname}`

### Phase 4: Testing & Migration

#### 4.1 Test Scenarios
- [ ] Create project with only frontend
- [ ] Create project with only backend
- [ ] Create project with frontend + backend
- [ ] Create project with all three (FE + BE + DB)
- [ ] Test API routing with different prefixes
- [ ] Test database connectivity from backend
- [ ] Test redeploy for each component
- [ ] Test delete for each component

#### 4.2 Data Migration (if needed)
- [ ] Script to migrate existing ProjectGroups
- [ ] Handle existing projects without roles
- [ ] Handle existing databases without groupId

---

## API Endpoints Summary

### Groups (Projects)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | List all projects with FE/BE/DB status |
| POST | `/api/groups` | Create new project (auto-generate slug) |
| GET | `/api/groups/:id` | Get project details |
| PATCH | `/api/groups/:id` | Update project (name, apiPathPrefix) |
| DELETE | `/api/groups/:id` | Delete project and all components |

### Frontend/Backend (Sites)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/projects` | Add frontend or backend to project |
| GET | `/api/projects/:id` | Get site details |
| DELETE | `/api/projects/:id` | Remove frontend/backend from project |
| POST | `/api/projects/:id/exec` | Execute script (backend only) |

### Database
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/databases` | Add database to project |
| GET | `/api/databases/:id` | Get database details |
| DELETE | `/api/databases/:id` | Remove database from project |
| POST | `/api/databases/:id/query` | Execute SQL query |

### Deployments
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/deployments/:projectId/deploy` | Deploy frontend or backend |
| POST | `/api/deployments/:projectId/redeploy` | Redeploy component |
| GET | `/api/deployments/status/:id` | Get deployment status |

### Files (VPSBuild-Managed Uploads)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/files/:groupId/upload?folder=uploads` | Upload file(s) to uploads folder |
| POST | `/api/files/:groupId/upload?folder=media` | Upload file(s) to media folder |
| GET | `/api/files/:groupId?folder=uploads` | List files in uploads folder |
| GET | `/api/files/:groupId?folder=media` | List files in media folder |
| DELETE | `/api/files/:groupId/:filename?folder=uploads` | Delete file from uploads |
| DELETE | `/api/files/:groupId/:filename?folder=media` | Delete file from media |

---

## Configuration Options

### Project Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `apiPathPrefix` | `/api` | URL prefix for backend API routes |

### Reserved Paths (VPSBuild-Managed, Not Configurable)
| Path | Description |
|------|-------------|
| `/uploads/*` | User-uploaded files via dashboard |
| `/media/*` | Media files via dashboard |

> **Note**: These paths are reserved and managed by VPSBuild. Users cannot change them.
> This ensures consistency across all projects and avoids conflicts with frontend assets.

### Possible Future Settings
| Setting | Default | Description |
|---------|---------|-------------|
| `customDomain` | null | Custom domain for project |
| `autoInjectDbUrl` | false | Auto-inject DATABASE_URL to backend |

---

## File Structure Changes

### Files to Delete
- `vps-front/src/pages/Databases.jsx`

### Files to Rename
- `vps-front/src/pages/GroupView.jsx` → `ProjectView.jsx`

### Files to Create
- [ ] `vps-front/src/components/FrontendCard.jsx`
- [ ] `vps-front/src/components/BackendCard.jsx`
- [ ] `vps-front/src/components/DatabaseCard.jsx`
- [ ] `vps-front/src/components/AddComponentWizard.jsx`
- [ ] `vps-front/src/components/FileManager.jsx` - Uploads/media file management
- [x] `vps-back/src/routes/files.js` - File upload/list/delete routes ✅ CREATED

### Files to Modify
- [x] `vps-back/prisma/schema.prisma` ✅ MODIFIED
- [x] `vps-back/src/routes/groups.js` ✅ MODIFIED
- [x] `vps-back/src/routes/projects.js` ✅ MODIFIED
- [x] `vps-back/src/routes/databases.js` ✅ MODIFIED
- [ ] `vps-back/src/routes/deployments.js`
- [x] `vps-back/src/lib/nginx-config-generator.js` ✅ MODIFIED
- [x] `vps-back/src/index.js` ✅ MODIFIED (added files route)
- [x] `vps-back/Dockerfile` ✅ MODIFIED (auto prisma db push on startup)
- [ ] `vps-front/src/App.jsx`
- [ ] `vps-front/src/pages/Dashboard.jsx`
- [ ] `vps-front/src/components/DeploymentWizard.jsx`

---

## Decisions Made

1. **Remove /databases page**: Database management moved inside project view
2. **API path configurable**: Users can set custom prefix (default `/api`)
3. **No auto-inject DATABASE_URL**: Users manually copy connection string to env vars
4. **One subdomain per project**: Frontend and backend share same subdomain
5. **Container naming**: `{slug}-frontend`, `{slug}-backend`, `{slug}-db`
6. **Max components**: 1 frontend + 1 backend + 1 database per project
7. **Static files convention (Option 1)**: Reserved `/uploads/` and `/media/` paths
   - VPSBuild manages these folders, NOT user's backend code
   - Users upload files through VPSBuild dashboard
   - Nginx serves files directly (fast, no backend proxy)
   - No user configuration needed - consistent across all projects
   - Avoids conflicts with frontend assets (Vite's `/assets/` folder)

---

## Notes for Implementation

1. **Start fresh**: No migration needed, development phase
2. **Backward compatibility**: Not required for this restructure
3. **Testing**: Test each phase before moving to next
4. **Rollback**: Keep git commits atomic for easy rollback

---

## References

- Current codebase: `D:\react\vpsbuilds\`
- Backend: `vps-back/`
- Frontend: `vps-front/`
- Similar platforms: Vercel, Railway, Render, Netlify






I've created a comprehensive plan at PROJECT_RESTRUCTURE_PLAN.md. Here's a summary:

  What's Covered in the Plan                                                                                                                                                            
  1. Architecture Comparison                                                                                                                                                          
  - Current: Multiple sites per group, separate subdomains, CORS issues
  - New: One project = one subdomain with FE + BE + DB

  2. UI Design
  - Dashboard with FE/BE/DB status indicators
  - Project view with 3 cards layout
  - 3-dot menu options for each card

  3. Database Schema Changes
  - Add slug and apiPathPrefix to ProjectGroup
  - Add role (FRONTEND/BACKEND) to Project
  - Link Database to ProjectGroup instead of User

  4. Implementation Tasks (4 Phases)
  - Phase 1: Schema & Backend Updates
  - Phase 2: Frontend Updates
  - Phase 3: Nginx & Routing
  - Phase 4: Testing

  5. Container Naming Convention
  Project: "bomf"
  ├── bomf-frontend  (port 80)
  ├── bomf-backend   (port 3000)
  └── bomf-db        (port 3306)

  6. Decisions Documented
  - Remove /databases page
  - Configurable API prefix (default /api)
  - No auto-inject DATABASE_URL
  - Max 1 of each component per project

  ---
  The plan is detailed enough that any AI or developer can pick it up and implement. Should I start implementing Phase 1 (Schema & Backend Updates)?