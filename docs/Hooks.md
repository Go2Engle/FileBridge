# Hooks

Hooks are reusable actions that run automatically before or after a transfer job executes. Use them to send notifications, call external APIs, or run scripts — without modifying job logic.

---

## How Hooks Work

Each hook is a standalone, named action with a type and configuration. Hooks are attached to jobs individually and fire at the trigger point you specify.

```
Job run starts
  └─ Pre-job hooks fire (in order)
       If any pre-job hook fails → job is aborted
  └─ Transfer executes
  └─ Post-job hooks fire (in order)
       If any post-job hook fails → run is marked failed, but remaining hooks still fire
```

**Pre-job hooks** are blocking — a failure cancels the transfer before any files move.

**Post-job hooks** are best-effort — all hooks run even if one fails, so multiple notification targets all receive the event.

---

## Hook Types

### Webhook

Sends an HTTP request to any URL when a hook fires.

| Field | Description |
|---|---|
| URL | The endpoint to call |
| Method | `GET`, `POST`, `PUT`, or `PATCH` (default: `POST`) |
| Headers | Optional key/value pairs (e.g. `Authorization: Bearer ...`) |
| Body template | Optional custom payload with [template variables](#template-variables). Leave blank to use the default JSON payload |
| Timeout | Maximum wait time in ms (default: 10,000) |

**Default JSON payload** (when no body template is set):

```json
{
  "job_id": 42,
  "job_name": "Daily CSV Export",
  "run_id": 187,
  "trigger": "post_job",
  "status": "success",
  "files_transferred": 3,
  "bytes_transferred": 204800,
  "error_message": null
}
```

---

### Email

Sends an SMTP email when a hook fires.

| Field | Description |
|---|---|
| SMTP Host | Your mail server hostname (e.g. `smtp.gmail.com`, `mail.company.local`) |
| Security | `None (port 25)`, `STARTTLS (port 587)`, or `SSL / TLS (port 465)` — selecting a mode auto-fills the port field |
| Port | Auto-filled by the Security selector; can be overridden manually |
| Username / Password | Leave blank for unauthenticated relays (common for internal port-25 servers) |
| From | Sender address, e.g. `FileBridge <noreply@company.com>` |
| To | Recipient(s), comma-separated for multiple addresses |
| Subject | Optional; supports [template variables](#template-variables). Default: `FileBridge · {job_name} — {status}` |
| Body | Optional plain-text body; supports template variables. Default: a plain-text summary |
| Timeout | Maximum wait time in ms (default: 10,000) |

**Gmail / Microsoft 365 tip:** Use an app-specific password rather than your account password, and set Security to STARTTLS (port 587).

**Internal relay tip:** If your mail server accepts connections on port 25 with no authentication, set Security to `None (port 25)` and leave Username/Password blank.

---

### Shell Command

Runs an arbitrary shell command on the FileBridge host when a hook fires.

| Field | Description |
|---|---|
| Command | Shell command or multi-line script |
| Working directory | Optional; defaults to the FileBridge install directory |
| Timeout | Maximum wait time in ms (default: 30,000) |

Job context is passed as environment variables:

| Variable | Value |
|---|---|
| `FILEBRIDGE_JOB_ID` | Numeric job ID |
| `FILEBRIDGE_JOB_NAME` | Job name string |
| `FILEBRIDGE_RUN_ID` | Numeric run ID |
| `FILEBRIDGE_TRIGGER` | `pre_job` or `post_job` |
| `FILEBRIDGE_STATUS` | `success` or `failure` (empty for pre-job) |
| `FILEBRIDGE_FILES_TRANSFERRED` | Count of files transferred |
| `FILEBRIDGE_BYTES_TRANSFERRED` | Total bytes transferred |
| `FILEBRIDGE_ERROR_MESSAGE` | Error message if the job failed, otherwise empty |

**Example — run a script:**

```sh
bash /opt/scripts/post-transfer.sh
```

**Example — multi-line:**

```sh
cd /opt/reports
python3 generate_report.py --job "$FILEBRIDGE_JOB_NAME" --status "$FILEBRIDGE_STATUS"
```

> **Security:** The command runs with the same OS privileges as the FileBridge process. Restrict access to the Hooks settings page to trusted admins.

---

## Template Variables

Webhook body templates and email subject/body fields support `{{variable}}` placeholders that are substituted at execution time:

| Variable | Example value |
|---|---|
| `{{job_id}}` | `42` |
| `{{job_name}}` | `Daily CSV Export` |
| `{{run_id}}` | `187` |
| `{{trigger}}` | `pre_job` or `post_job` |
| `{{status}}` | `success` or `failure` |
| `{{files_transferred}}` | `3` |
| `{{bytes_transferred}}` | `204800` |
| `{{error_message}}` | Error text, or empty string |

---

## Creating a Hook

1. Navigate to **Settings → Hooks**
2. Click **New Hook**
3. Enter a name and optional description
4. Select a type: **Webhook**, **Email**, or **Shell Command**
5. Fill in the type-specific fields
6. Toggle **Enabled** as needed
7. Click **Create Hook**

The hook appears in the hooks list and is now available to attach to jobs.

> **Tip:** Use the [Hook Library](Hook-Library) to import pre-built templates instead of configuring hooks from scratch.

---

## Attaching Hooks to Jobs

Hooks are attached per-job in the job form.

1. Open the job (create or edit)
2. Scroll to the **Hooks** section
3. Select one or more hooks and choose a trigger: **Before transfer** (pre-job) or **After transfer** (post-job)
4. Save the job

Multiple hooks can be attached to the same trigger. They fire in the order they are listed.

---

## Viewing Hook Run Logs

Every hook execution is recorded. To view results:

1. Open a job and click into a specific run
2. The run log table shows both file transfer entries and hook entries side by side
3. Hook rows show the hook name, type, trigger, status (success / failure), duration, and any output or error message

---

## Enabling and Disabling Hooks

Hooks have a global **Enabled** toggle independent of job attachments. A disabled hook is silently skipped on all jobs — useful for temporarily pausing notifications without removing the hook from every job.

---

## Security

All hook configurations — including SMTP passwords, webhook URLs, and API keys — are encrypted at rest using AES-256-GCM. The encryption key is derived from your `AUTH_SECRET` environment variable. Configs are decrypted in memory only when a hook executes.

Rotating `AUTH_SECRET` will invalidate all stored hook configurations; re-enter them after any key rotation.
