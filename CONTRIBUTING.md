# Contributing to FileBridge

Thank you for your interest in contributing to FileBridge! This guide covers everything you need to get a local development environment running and submit quality pull requests.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Code Style](#code-style)
- [Important Conventions](#important-conventions)
- [Database Changes](#database-changes)
- [Adding a Storage Provider](#adding-a-storage-provider)
- [Branching & Commit Messages](#branching--commit-messages)
- [Pull Request Process](#pull-request-process)
- [Reporting Bugs & Requesting Features](#reporting-bugs--requesting-features)

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | ≥ 20 |
| npm | ≥ 10 |
| Git | any recent version |

> **Note on SMB / NTLMv2:** The SMB provider uses the MD4 algorithm for NTLM authentication. On Node.js 17+, OpenSSL's legacy providers are required. The dev script sets this automatically via `NODE_OPTIONS=--openssl-legacy-provider`.

---

## Development Setup

```bash
# 1. Clone the repository
git clone https://github.com/go2engle/FileBridge.git
cd FileBridge

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and set at minimum:
#   AUTH_SECRET=<run: openssl rand -base64 32>
#   NEXTAUTH_URL=http://localhost:3000

# 4. Start the development server
npm run dev

# For readable, pretty-printed logs:
npm run dev:pretty
```

The app will be available at `http://localhost:3000`. On first boot, the SQLite database is auto-created at `data/filebridge.db` with all required tables.

**Dev auth bypass** (skip login during development):

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
```

---

## Project Structure

```
FileBridge/
├── app/                    # Next.js App Router
│   ├── (dashboard)/        # Protected pages (auth-guarded)
│   ├── api/                # API route handlers
│   ├── login/              # Login page
│   └── setup/              # First-run setup
├── components/             # React components
│   ├── ui/                 # Shared UI primitives (shadcn/ui)
│   └── */                  # Feature-specific components
├── lib/
│   ├── auth/               # NextAuth config
│   ├── db/                 # SQLite schema, migrations, CRUD helpers
│   ├── scheduler/          # node-cron job scheduling
│   ├── storage/            # Storage provider interface + implementations
│   └── transfer/           # Core transfer engine
├── hooks/                  # React custom hooks
├── types/                  # Shared TypeScript types
├── instrumentation.ts      # Scheduler initialization (Node.js runtime startup)
└── .env.example            # Environment variable reference
```

---

## Code Style

- **TypeScript** — strict mode enabled; avoid `any`
- **Linting** — ESLint flat config (`eslint.config.mjs`); run `npm run lint` before opening a PR and fix all errors
- **UI** — [shadcn/ui](https://ui.shadcn.com/) "new-york" style; prefer existing component primitives over custom elements
- **Logging** — use `createLogger(component)` from `lib/logger.ts` rather than `console.log`; wrap job-context code with `withJobContext`
- **Formatting** — no enforced formatter is configured, but follow the style of surrounding code

---

## Important Conventions

These are known sharp edges that have caused regressions. Please read before touching related code.

### node-cron v4 — named imports only

```ts
// ✅ Correct
import { schedule, validate } from "node-cron";
import type { ScheduledTask } from "node-cron";

// ❌ Wrong — default import does not work in v4
import cron from "node-cron";
```

Files: [lib/scheduler/index.ts](lib/scheduler/index.ts), [lib/backup/index.ts](lib/backup/index.ts)

### @hookform/resolvers v5 — requires type cast

```ts
// ✅ Correct
import { useForm, type Resolver } from "react-hook-form";

const form = useForm<FormValues>({
  resolver: zodResolver(schema) as Resolver<FormValues>,
});

// ❌ Wrong — omitting the cast causes TypeScript errors in v5
```

### lucide-react icon renames

Several icons were renamed in lucide-react ≥ 0.475:

| Old name | New name |
|----------|----------|
| `Edit2` | `PenLine` |
| `AlertCircle` | `CircleAlert` |
| `RefreshCcw` | `RotateCcw` |
| `ArrowUpCircle` | `CircleArrowUp` |
| `CheckCircle` | `CircleCheck` |
| `CheckCircle2` | `CircleCheckBig` |
| `XCircle` | `CircleX` |

### `useSearchParams()` requires a Suspense boundary

Isolate any component calling `useSearchParams()` in a child component wrapped with `<Suspense>`.

### Credential encryption

The `credentials` column in the `connections` table stores AES-256-GCM ciphertext as plain `text` (not JSON mode). Always use the helpers in [lib/db/connections.ts](lib/db/connections.ts):

```ts
// Reading — auto-decrypts
const conn = await getConnection(id);
const all  = await getAllConnections();

// Writing — always encrypt first
const encrypted = encryptCreds(plainCreds);
db.insert(connections).values({ ..., credentials: encrypted });
```

> **Warning:** The encryption key is derived from `AUTH_SECRET`. Rotating `AUTH_SECRET` will invalidate all stored credentials — users will need to re-enter passwords for every connection.

---

## Database Changes

FileBridge uses [Drizzle ORM](https://orm.drizzle.team/) with SQLite. Schema lives in [lib/db/schema.ts](lib/db/schema.ts); migrations are applied at startup in [lib/db/index.ts](lib/db/index.ts).

When changing the schema:

1. Edit `lib/db/schema.ts`
2. Generate the migration: `npm run db:generate`
3. Apply it: `npm run db:push`
4. Add the corresponding `ALTER TABLE` statement to the startup migration block in `lib/db/index.ts` so it runs automatically for existing deployments
5. Use `npm run db:studio` to inspect the database visually

---

## Adding a Storage Provider

Storage providers are pluggable. To add a new protocol:

1. **Implement the interface** — create `lib/storage/<protocol>.ts` and implement `StorageProvider` from [lib/storage/interface.ts](lib/storage/interface.ts):

   ```ts
   export interface StorageProvider {
     listFiles(path: string, pattern?: string): Promise<FileInfo[]>;
     downloadFile(remotePath: string): Promise<NodeJS.ReadableStream>;
     uploadFile(remotePath: string, stream: NodeJS.ReadableStream): Promise<void>;
     deleteFile(path: string): Promise<void>;
     moveFile(src: string, dest: string): Promise<void>;
     createDirectory(path: string): Promise<void>;
   }
   ```

2. **Register the provider** — add it to [lib/storage/registry.ts](lib/storage/registry.ts)

3. **Declare as external** — add the provider's native package to `serverExternalPackages` in [next.config.ts](next.config.ts) so Next.js doesn't try to bundle it

4. **Add connection form fields** — update the connection UI in `components/connections/` to expose the new protocol's credentials

---

## Branching & Commit Messages

Use a descriptive branch name with a prefix:

```
feat/azure-ad-group-sync
fix/smb-sharing-violation-retry
docs/contributing-guide
chore/upgrade-drizzle-0.45
```

Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages:

```
feat: add Azure Blob delta sync support
fix: handle STATUS_FILE_CLOSED with SMB reconnect
docs: add storage provider guide to contributing
chore: upgrade node-cron to v4
```

Link related issues in the commit or PR body (`Closes #42`).

---

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes following the conventions above
3. Run `npm run lint` — fix all errors before opening the PR
4. Fill in the pull request template completely
5. Describe how you tested the change (environment, protocol, steps)
6. A maintainer will review and may request changes

---

## Reporting Bugs & Requesting Features

Use the GitHub issue templates:

- **Bug Report** — for reproducible problems
- **Feature Request** — for new functionality or improvements

Please search existing issues before opening a new one.
