# Database Backups

FileBridge includes a built-in backup system for the SQLite database. Backups can run on a schedule or be triggered manually from the Settings page.

---

## How Backups Work

FileBridge uses `better-sqlite3`'s **online backup API** — the same mechanism SQLite uses internally for safe, consistent snapshots. This means:

- Backups are taken while the database is live, with **no downtime**
- The backup is a complete, valid SQLite database file
- A write lock is never held for the full duration — I/O is chunked to avoid blocking ongoing requests
- Every backup is verified with `PRAGMA integrity_check` before being saved

If the integrity check fails, the backup file is deleted and an error is thrown. You will never have a corrupt backup silently sitting in the backup directory.

---

## Configuration

Backup settings are configured at **Settings → Database Backups** in the UI, or directly via the `POST /api/settings` API.

| Setting | Default | Description |
|---|---|---|
| **Enable scheduled backups** | Off | Toggle the automatic backup cron job |
| **Schedule** | `0 2 * * *` | Cron expression for when backups run (default: 2:00 AM daily) |
| **Local backup path** | `<cwd>/data/backups` | Directory where backup `.db` files are stored |
| **Retention count** | 7 | Number of backups to keep — oldest are pruned automatically |

Settings are persisted in the `settings` table under the key `"backup"`.

---

## Backup File Naming

Backup files follow this format:

```
filebridge-2026-02-22T02-00-00-000Z.db
```

The timestamp is the ISO 8601 UTC time with `:` and `.` replaced by `-` to ensure safe filenames on all platforms. Files are lexicographically sortable (oldest first), which the retention pruning relies on.

---

## Running a Backup

### Scheduled

Enable automatic backups in **Settings → Database Backups** and set a cron schedule. The backup scheduler is initialized at startup alongside the job scheduler. When you save new backup settings, the scheduler is re-initialized immediately — no restart required.

### Manual

Click **Backup Now** on the Settings page, or call:

```http
POST /api/backup/run
```

**Response**:
```json
{
  "filename": "filebridge-2026-02-22T10-15-30-000Z.db",
  "path": "/app/data/backups/filebridge-2026-02-22T10-15-30-000Z.db",
  "sizeBytes": 204800,
  "createdAt": "2026-02-22T10:15:30.000Z",
  "integrity": "ok"
}
```

---

## Listing Backups

The Settings page displays all available backups with their filename, size, and creation time.

Via API:

```http
GET /api/backup/list
```

---

## Retention

After each backup, the system prunes old backups if the total count exceeds the configured retention count. The oldest files (by filename sort order) are deleted first. The currently created backup does **not** count against the retention limit until the next run.

Example: With `retentionCount = 7`, after the 8th backup runs, the oldest backup is deleted, leaving exactly 7.

---

## Restoring a Backup

### In-App Restore (No Restart Required)

FileBridge supports live restore using SQLite's `ATTACH DATABASE` mechanism:

1. Go to **Settings → Database Backups**
2. Find the backup you want to restore
3. Click **Restore**
4. Confirm the operation

The restore process:
1. Verifies the backup file's integrity (`PRAGMA integrity_check`) — aborts if corrupt
2. Creates a **pre-restore safety backup** of the current database
3. Attaches the backup file as a secondary database
4. Wraps all table replacements in a single SQLite transaction:
   - Deletes all rows from each table (`connections`, `jobs`, `job_runs`, `transfer_logs`, `settings`)
   - Re-inserts all rows from the backup
5. Detaches the backup database
6. Foreign key checks are disabled during the transaction and re-enabled after

Tables are restored in dependency-safe order to avoid FK constraint violations.

> **Warning**: Any in-flight web requests during the restore window may see inconsistent data. For production environments with active traffic, schedule restores during low-activity windows.

### Manual Restore (Alternative)

If the in-app restore is not suitable, you can restore manually:

1. Stop the FileBridge process
2. Replace `data/filebridge.db` with the desired backup `.db` file:
   ```bash
   cp data/backups/filebridge-2026-02-22T02-00-00-000Z.db data/filebridge.db
   ```
3. Restart the process

Every backup file is a fully valid, standalone SQLite database. No import step is needed.

---

## Security Considerations

- The restore endpoint validates that the requested filename does not escape the backup directory (path traversal protection)
- Backup files contain the full database including all job configurations and settings — secure the backup directory appropriately
- Credentials stored in `connections.credentials` are included in backups. Until field-level encryption is implemented, treat backup files as sensitive

---

## Docker / Volume Mounts

In a Docker deployment, ensure your backup directory is on a persistent volume separate from the main database:

```yaml
volumes:
  - filebridge-data:/app/data        # main database
  - filebridge-backups:/app/backups  # backup files
```

Or use a single volume with subdirectories and set:
```env
DATABASE_PATH=/app/data/filebridge.db
# Backup path configured in Settings UI: /app/data/backups
```

See [Docker Deployment](Docker-Deployment) for full container configuration.
