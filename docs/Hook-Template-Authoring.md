# Hook Template Authoring

Hook templates are YAML files that describe a reusable hook configuration. They power the [Hook Library](Hook-Library) and let you share integrations with other FileBridge users.

---

## File Format

```yaml
name: My Hook                    # required — display name in the library
description: >                   # optional — shown below the name
  What this hook does and when
  to use it.
type: webhook                    # required — webhook | email | shell
tags:                            # optional — used for search
  - slack
  - notification
author: your-github-username     # optional — shown in the library card

inputs:                          # optional — user-configurable fields at import time
  - id: WEBHOOK_URL
    label: Webhook URL
    type: text
    required: true
    placeholder: "https://hooks.slack.com/..."
    description: "Paste your Slack incoming webhook URL here"

config:                          # required — the hook's runtime configuration
  url: "{{WEBHOOK_URL}}"
```

---

## Top-Level Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name shown in the library |
| `description` | string | no | Short description of the hook's purpose |
| `type` | string | yes | `webhook`, `email`, or `shell` |
| `tags` | list of strings | no | Keywords for search (e.g. `slack`, `smtp`, `notification`) |
| `author` | string | no | Your GitHub username or `"FileBridge Community"` |
| `inputs` | list | no | User-configurable fields — see [Inputs](#inputs) |
| `config` | object | yes | Hook configuration — see [Config by type](#config-by-type) |

---

## Inputs

`inputs` defines the fields shown to the user in the "Configure & Import" form. Each entry becomes a substitution placeholder in `config`.

```yaml
inputs:
  - id: FIELD_ID          # referenced as {{FIELD_ID}} in config
    label: Display Label  # shown above the input in the form
    type: text            # text | secret | number
    required: true        # shows * and blocks import if empty
    default: "587"        # pre-filled value (optional)
    placeholder: "..."    # hint text shown in the input (optional)
    description: "..."    # help text shown below the input (optional)
```

### Input Types

| Type | Rendered as | Use for |
|---|---|---|
| `text` | Plain text input | Hostnames, URLs, email addresses |
| `secret` | Password input with show/hide toggle | Passwords, API keys, tokens |
| `number` | Number input | Ports, timeouts |

Templates with no `inputs` list import instantly without showing a configuration form.

---

## Config by Type

### Webhook config

```yaml
config:
  url: "{{WEBHOOK_URL}}"          # required
  method: POST                    # GET | POST | PUT | PATCH (default: POST)
  headers:                        # optional key/value map
    Content-Type: application/json
    Authorization: "Bearer {{API_TOKEN}}"
  body: |                         # optional body template
    {"text": "{{job_name}} finished with status {{status}}"}
  timeoutMs: 10000                # optional (default: 10000)
```

### Email config

```yaml
config:
  host: "{{SMTP_HOST}}"           # required
  port: "{{SMTP_PORT}}"           # default: 587
  secure: false                   # true = SSL/TLS (port 465), false = STARTTLS or plain
  username: "{{SMTP_USERNAME}}"   # optional — omit for unauthenticated relays
  password: "{{SMTP_PASSWORD}}"   # optional
  from: "{{FROM_ADDRESS}}"        # required
  to: "{{TO_ADDRESS}}"            # required — comma-separated for multiple recipients
  subject: "FileBridge: {{job_name}} {{status}}"   # optional template string
  body: |                         # optional template string
    Job: {{job_name}}
    Status: {{status}}
    Files transferred: {{files_transferred}}
    Trigger: {{trigger}}
  html: false                     # set true if body contains HTML
  timeoutMs: 10000                # optional (default: 10000)
```

### Shell config

```yaml
config:
  command: "bash /opt/scripts/notify.sh"   # required
  workingDir: "/opt/scripts"               # optional
  timeoutMs: 30000                         # optional (default: 30000)
```

---

## Placeholders: Import-time vs Runtime

FileBridge uses `{{PLACEHOLDER}}` syntax for two different purposes. It is important to understand the difference:

### Import-time placeholders

Defined in `inputs` with a matching `id`. These are filled in by the user when they click "Configure & Import" and are substituted **once** before the hook is saved.

```yaml
inputs:
  - id: WEBHOOK_URL
    ...
config:
  url: "{{WEBHOOK_URL}}"   # ← substituted at import time
```

After import, the saved hook config contains the actual URL — not the placeholder.

### Runtime variables

These are **not** defined in `inputs`. They are substituted **each time the hook fires**, using live values from the job run.

| Variable | Value at runtime |
|---|---|
| `{{job_id}}` | Numeric job ID |
| `{{job_name}}` | Job name |
| `{{run_id}}` | Numeric run ID |
| `{{trigger}}` | `pre_job` or `post_job` |
| `{{status}}` | `success` or `failure` |
| `{{files_transferred}}` | Count of files transferred |
| `{{bytes_transferred}}` | Total bytes in bytes |
| `{{error_message}}` | Error text, or empty string |

Runtime variables in `config.body`, `config.subject`, and `config.command` are left as-is at import time and expanded later at execution time.

**Rule of thumb:** If the placeholder appears in `inputs`, it is an import-time variable. If it is one of the eight listed above, it is a runtime variable. All other unknown placeholders are left as-is.

---

## Complete Examples

### Slack notification (webhook)

```yaml
name: Slack Notification
description: >
  Posts a message to a Slack channel when a job completes.
  Requires a Slack incoming webhook URL.
type: webhook
tags:
  - slack
  - notification
author: FileBridge Community
inputs:
  - id: SLACK_WEBHOOK_URL
    label: Slack Webhook URL
    type: secret
    required: true
    placeholder: "https://hooks.slack.com/services/..."
    description: "Create one at api.slack.com/apps → Incoming Webhooks"
config:
  url: "{{SLACK_WEBHOOK_URL}}"
  method: POST
  headers:
    Content-Type: application/json
  body: |
    {"text": "FileBridge · *{{job_name}}* finished with status *{{status}}*\nFiles transferred: {{files_transferred}}"}
  timeoutMs: 10000
```

### Email notification (email)

```yaml
name: Email Notification
description: >
  Sends an SMTP email when a job completes.
  Works with Gmail, Microsoft 365, and internal mail relays.
type: email
tags:
  - email
  - smtp
  - notification
author: FileBridge Community
inputs:
  - id: SMTP_HOST
    label: SMTP Host
    type: text
    required: true
    placeholder: "smtp.gmail.com"
  - id: SMTP_PORT
    label: SMTP Port
    type: number
    required: false
    default: "587"
    placeholder: "587"
  - id: SMTP_USERNAME
    label: Username
    type: text
    required: false
    placeholder: "you@example.com"
  - id: SMTP_PASSWORD
    label: Password
    type: secret
    required: false
    placeholder: "your-app-password"
    description: "Use an app-specific password for Gmail or Microsoft 365"
  - id: FROM_ADDRESS
    label: From
    type: text
    required: true
    placeholder: "FileBridge <noreply@example.com>"
  - id: TO_ADDRESS
    label: To
    type: text
    required: true
    placeholder: "admin@example.com"
    description: "Comma-separated for multiple recipients"
config:
  host: "{{SMTP_HOST}}"
  port: "{{SMTP_PORT}}"
  username: "{{SMTP_USERNAME}}"
  password: "{{SMTP_PASSWORD}}"
  from: "{{FROM_ADDRESS}}"
  to: "{{TO_ADDRESS}}"
  subject: "FileBridge: {{job_name}} {{status}}"
  body: |
    Job {{job_name}} completed.
    Files transferred: {{files_transferred}}
    Trigger: {{trigger}}
    Status: {{status}}
  timeoutMs: 10000
```

### Cleanup script (shell, no inputs)

```yaml
name: Cleanup Temp Files
description: >
  Removes files older than 7 days from /tmp/filebridge after each job run.
  No configuration required.
type: shell
tags:
  - maintenance
  - shell
author: FileBridge Community
config:
  command: "find /tmp/filebridge -type f -mtime +7 -delete"
  timeoutMs: 30000
```

---

## Naming and File Placement

| Rule | Detail |
|---|---|
| Filename | `kebab-case.yaml` — lowercase, hyphens only |
| Community templates | `hooks-library/community/<filename>.yaml` in the repo |
| Local templates | `hooks-library/local/<filename>.yaml` on your server |
| Unique names | Each template should have a distinct `name` value to avoid import conflicts |

---

## Submitting to the Community

Community templates live in `hooks-library/community/` in the FileBridge GitHub repository. To submit one:

1. **Fork** the [FileBridge repository](https://github.com/go2engle/FileBridge) on GitHub
2. **Create a branch**: `feat/hook-my-integration-name`
3. **Add your template** to `hooks-library/community/` following the format above
4. **Validate the YAML**:
   ```bash
   python3 -c "import yaml,sys; yaml.safe_load(sys.stdin)" < hooks-library/community/my-hook.yaml
   ```
5. **Test it** against a real FileBridge job run (pre-job or post-job trigger)
6. **Open a pull request** using the **Hook Submission** template — fill in all checklist items

### Submission checklist

- [ ] Filename is `kebab-case.yaml`
- [ ] `name`, `type`, and `config` are all present
- [ ] All secrets and configurable values use `inputs` with `type: secret` or `type: text`
- [ ] No hardcoded credentials, URLs, or hostnames
- [ ] `description` explains what the hook does and any required setup
- [ ] `author` is set to your GitHub username or `"FileBridge Community"`
- [ ] Tested against a real FileBridge job run
- [ ] YAML validates cleanly

### What maintainers look for

- **No hardcoded secrets** — all user-specific values must be `inputs`
- **Clear description** — users should understand what the hook does and what they need to configure before importing
- **Reasonable defaults** — `default` values should match common setups (e.g. port 587 for SMTP)
- **Correct runtime variable usage** — `{{job_name}}`, `{{status}}` etc. in `body`/`subject` should not appear in `inputs`
