---
name: testing-multica-web
description: Test the Multica web frontend end-to-end. Use when verifying UI changes, sidebar navigation, route pages, or issue creation flows.
---

# Testing Multica Web Frontend

## Prerequisites

- Node.js 22+ (check with `node --version`)
- pnpm installed (`pnpm --version`)
- Docker for PostgreSQL and backend containers

## Devin Secrets Needed

- `GITHUB_PAT` — GitHub Personal Access Token with `repo` scope (or fine-grained with Issues:Read + Metadata:Read). Required for testing the GitHub import feature. Without it, you can only test that the modal opens and invalid tokens produce errors.

## Local Dev Setup

1. **Create `.env` from `.env.example`:**
   ```bash
   cp .env.example .env
   sed -i 's/^JWT_SECRET=.*/JWT_SECRET=test-secret-for-dev/' .env
   sed -i 's/^APP_ENV=.*/APP_ENV=development/' .env
   sed -i 's/^MULTICA_DEV_VERIFICATION_CODE=.*/MULTICA_DEV_VERIFICATION_CODE=888888/' .env
   ```

2. **Start PostgreSQL + backend via Docker Compose:**
   ```bash
   docker compose -f docker-compose.selfhost.yml up -d postgres backend
   ```
   Wait for backend health: `curl -s http://localhost:8080/health` should return `{"status":"ok"}`

3. **CORS: Set FRONTEND_ORIGIN if using a non-default port:**
   If the frontend runs on a port other than 3000 (e.g. 3001), add `FRONTEND_ORIGIN=http://localhost:<port>` to `.env` and restart the backend container.

4. **Start frontend dev server:**
   ```bash
   FRONTEND_PORT=3001 NEXT_PUBLIC_API_URL=http://localhost:8080 NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws pnpm dev:web
   ```
   First page loads may take 10-30s to compile (Next.js dev mode).

## Login Flow

1. Navigate to `http://localhost:<port>/login`
2. Enter any email (e.g. `test@test.com`)
3. Click Continue
4. Enter verification code `888888`
5. If the page doesn't redirect after successful verification, manually navigate to `/`
6. Complete onboarding (skip survey questions, name workspace, skip agent runtime setup)

## Key Testing Areas

### Sidebar Navigation
- File: `packages/views/layout/app-sidebar.tsx`
- Contains `workspaceNav` and `configureNav` arrays that define sidebar items
- Sidebar renders inside the dashboard layout at `apps/web/app/[workspaceSlug]/(dashboard)/layout.tsx`

### Route Pages
- Dashboard routes live under `apps/web/app/[workspaceSlug]/(dashboard)/`
- Each feature has its own directory (e.g. `agents/`, `squads/`, `issues/`)
- Deleted route directories result in Next.js 404 pages

### Issue Creation Mode
- File: `packages/core/issues/stores/create-mode-store.ts`
- `lastMode` controls whether `c` shortcut opens "Create manually" or agent quick-create
- The modal title shows "Create manually" when in manual mode

## Common Issues

- **Port 3000 already in use:** The Docker frontend container (if running from selfhost compose) may occupy port 3000. Use `FRONTEND_PORT=3001` or kill the conflicting process.
- **"Failed to fetch" on login:** CORS issue. Ensure `FRONTEND_ORIGIN` in `.env` matches the frontend's actual URL (including port), then restart the backend container.
- **Verification code page stuck after entering code:** The backend may have logged success but the frontend didn't redirect. Navigate to `/` manually — the auth token is set.
- **Slow page loads:** First visit to each Next.js route triggers compilation (10-30s). Subsequent visits are fast.

### GitHub Import Feature
- File: `packages/views/modals/github-import.tsx` (modal component)
- File: `packages/views/projects/components/projects-page.tsx` (button location)
- Backend: `server/internal/handler/github_import.go` (5 endpoints under `/api/github-import/`)
- **Testing flow**: Projects page → "Import from GitHub" button → modal step 1 (PAT input) → step 2 (repo picker with search) → click Import → project created with issues
- **Login shortcut**: In `APP_ENV=development`, entering the email may auto-redirect without needing the 888888 code if a session already exists
- **Search limitation**: The GitHub search API uses `user:@me` which only returns repos owned by the authenticated user. Organization repos appear in browse mode (empty search) but not in filtered search results. This is a known behavioral inconsistency.
- **After import**: The modal closes and the user stays on the Projects list. The project appears in the list immediately. No auto-redirect to project detail.
- **Backend setup note**: If building the Go backend from source, ensure `MULTICA_GITHUB_PAT_KEY` or `JWT_SECRET` env var is set — the PAT encryption uses one of these as the AES key source.

## Typecheck & Tests

```bash
pnpm typecheck        # TypeScript check across all packages
pnpm test             # Vitest unit tests
pnpm --filter @multica/views exec vitest run layout/app-sidebar.test.tsx  # Sidebar-specific test
```
