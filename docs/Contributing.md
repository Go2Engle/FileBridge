# Contributing

Thank you for your interest in contributing to FileBridge! This page covers the development workflow, commit conventions, and how the automated release pipeline works.

For the full contributor reference (code conventions, storage provider authoring, hook templates, database changes) see [CONTRIBUTING.md](https://github.com/Go2Engle/FileBridge/blob/main/CONTRIBUTING.md) in the repository root.

---

## Development Setup

```bash
# 1. Clone and install
git clone https://github.com/Go2Engle/FileBridge.git
cd FileBridge
npm install

# 2. Configure environment
cp .env.example .env
# Set at minimum:
#   AUTH_SECRET=<openssl rand -base64 32>
#   NEXTAUTH_URL=http://localhost:3000

# 3. Start dev server
npm run dev        # structured JSON logs
npm run dev:pretty # human-readable logs via pino-pretty
```

**Dev auth bypass** (skip the login page locally):

```env
AUTH_BYPASS_DEV=true
NEXT_PUBLIC_AUTH_BYPASS_DEV=true
```

The SQLite database is created automatically at `data/filebridge.db` on first boot.

### Useful scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start Next.js dev server |
| `npm run lint` | ESLint — fix all errors before opening a PR |
| `npm run typecheck` | TypeScript strict check |
| `npm run test` | Vitest unit + integration tests |
| `npm run test:coverage` | Tests with coverage report |
| `npm run db:studio` | Drizzle Studio (visual DB inspector) |
| `npm run db:generate` | Generate a migration after schema changes |
| `npm run db:push` | Apply pending migrations |
| `npm run ci` | Full CI gate: lint + typecheck + test |

---

## Branching

Use a descriptive branch name with one of these prefixes:

```
feat/azure-ad-group-sync
fix/smb-sharing-violation-retry
docs/update-contributing-guide
chore/upgrade-drizzle-0.45
```

Always branch from `main`.

---

## Commit Messages

FileBridge uses **[Conventional Commits](https://www.conventionalcommits.org/)**. Every commit message must follow the format:

```
<type>[optional scope]: <description>

[optional body]

[optional footer — e.g. Closes #42 or BREAKING CHANGE: ...]
```

### Types

| Type | When to use |
|---|---|
| `feat` | A new user-facing feature |
| `fix` | A bug fix |
| `perf` | A performance improvement |
| `deps` | Dependency updates |
| `revert` | Reverting a previous commit |
| `docs` | Documentation changes only |
| `chore` | Maintenance, config tweaks, tooling |
| `refactor` | Code restructuring with no behaviour change |
| `test` | Adding or updating tests |
| `ci` | CI/CD workflow changes |
| `build` | Build system changes |

### Examples

```
feat: add Azure Blob delta sync support
fix: handle STATUS_FILE_CLOSED with SMB reconnect
perf: cache connection pool across scheduler ticks
deps: upgrade drizzle-orm to 0.45
docs: add storage provider authoring guide
chore: remove unused lucide-react icons
refactor: extract transfer retry logic into helper
test: cover edge cases in pgp decryption
```

### Breaking changes

Add `!` after the type, or include a `BREAKING CHANGE:` footer:

```
feat!: rename SFTP credential fields

BREAKING CHANGE: `host_key` is now `hostKey` in the connections schema.
Existing connections must be re-saved after upgrading.
```

---

## Pull Request Process

1. Fork the repo and create a branch from `main`
2. Make your changes following the conventions above
3. Run `npm run ci` — all checks must pass
4. Fill in the PR template completely, including how you tested the change
5. A maintainer will review and may request changes

:::tip
Never manually edit the `version` field in `package.json` or commit `package-lock.json` as part of a feature or fix PR. Version bumps are handled automatically by the release pipeline — see below.
:::

---

## Release Process

FileBridge uses **[Release Please](https://github.com/googleapis/release-please)** for fully automated, zero-touch releases.

### How it works

```
Developer PRs (feat/fix/etc.)
        │
        ▼ merge to main
┌─────────────────────────────────────┐
│  release-please workflow runs       │
│  • parses conventional commits      │
│  • calculates next semver bump      │
│  • opens/updates a "Release PR"     │
│    with bumped package.json +       │
│    generated CHANGELOG.md entry     │
└───────────────────┬─────────────────┘
                    │ maintainer merges Release PR
                    ▼
        GitHub Release published
                    │
                    ▼
        release workflow runs
        ┌───────────────────────────────────┐
        │  Docker (linux/amd64, linux/arm64) │
        │  Standalone bundles (all platforms) │
        │  → attached to GitHub Release       │
        └───────────────────────────────────┘
```

### Version bump rules

| Commit type | Changelog section | Version bump |
|---|---|---|
| `feat:` | Features | **minor** — `0.x.0` |
| `fix:` | Bug Fixes | **patch** — `0.0.x` |
| `perf:` | Performance Improvements | patch |
| `deps:` | Dependencies | patch |
| `revert:` | Reverts | patch |
| `feat!:` or `BREAKING CHANGE:` | Features | **major** — `x.0.0` |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:`, `build:` | *(hidden — tracked but not shown)* | none |

### What contributors need to do

**Nothing special.** Write conventional commits, open your PR, get it merged. The bot handles the rest.

### What maintainers do to ship a release

1. Wait for enough PRs to accumulate on `main`
2. Find the open **"chore(main): release x.y.z"** PR created by the Release Please bot
3. Review the generated changelog entry
4. Merge it — Docker images and standalone bundles build and publish automatically

---

## Reporting Bugs & Requesting Features

Use the GitHub issue templates:

- **Bug Report** — for reproducible problems with steps to reproduce
- **Feature Request** — for new functionality or improvements

Please search existing issues before opening a new one.
