# Connections

Connections define the credentials and endpoints for your storage systems. FileBridge currently supports three storage protocols, with more planned.

---

## Supported Protocols

| Protocol | Use Case |
|---|---|
| **SFTP** | Linux/Unix servers, NAS devices with SSH, cloud VMs |
| **SMB/CIFS** | Windows file shares, NAS appliances (Synology, QNAP, etc.) |
| **Azure Blob Storage** | Microsoft Azure cloud object storage |

---

## Managing Connections

Navigate to **Connections** in the sidebar. From here you can:

- **Create** a new connection with the **New Connection** button
- **Edit** an existing connection — credentials are loaded securely (never exposed in list responses)
- **Test** a connection to verify reachability and auth before saving
- **Delete** a connection — only possible if no jobs reference it (referential integrity enforced)

---

## SFTP Connections

### Fields

| Field | Required | Description |
|---|---|---|
| Name | Yes | Display name for this connection |
| Host | Yes | Hostname or IP address of the SFTP server |
| Port | Yes | Default: `22` |
| Username | Yes | SSH username |
| Authentication | Yes | **Password** or **Private Key** |
| Password | If password auth | SSH password |
| Private Key | If key auth | PEM-formatted SSH private key (RSA, ECDSA, Ed25519) |
| Passphrase | No | Passphrase for encrypted private keys |

### Notes

- Private keys are stored as JSON in the database. Treat the database file as sensitive.
- The connection test verifies SSH authentication and lists the root directory.

---

## SMB/CIFS Connections

### Fields

| Field | Required | Description |
|---|---|---|
| Name | Yes | Display name for this connection |
| Host | Yes | Hostname or IP of the Windows/SMB server |
| Port | Yes | Default: `445` |
| Share | Yes | SMB share name (e.g. `files`, `data`) |
| Domain | No | Windows domain name (for domain-joined accounts) |
| Username | Yes | SMB username |
| Password | Yes | SMB password |

### NTLMv2 Authentication

FileBridge uses the `v9u-smb2` library, a fork with full NTLMv2 support. This enables compatibility with:
- Windows Server file shares (2008 R2+)
- Synology NAS (DSM 7+)
- QNAP NAS
- Other NTLMv2-enforcing SMB servers

> **Note**: MD4 (used internally by NTLM) requires OpenSSL legacy mode. The `npm` scripts set `NODE_OPTIONS=--openssl-legacy-provider` automatically. In Docker, include `ENV NODE_OPTIONS=--openssl-legacy-provider` in your Dockerfile.

### SMB Streaming

File transfers use v9u-smb2's native `createReadStream`/`createWriteStream` for true 64 KB chunk streaming. Files of any size can be transferred with constant memory usage — no full-file buffering.

### SMB Reliability

The SMB provider includes automatic retry logic to handle common transient errors:

- **STATUS_FILE_CLOSED** — Reconnects and retries the operation
- **STATUS_SHARING_VIOLATION** — Waits briefly for handle release and retries
- **STATUS_PENDING** — Backs off and retries

---

## Azure Blob Storage Connections

### Fields

| Field | Required | Description |
|---|---|---|
| Name | Yes | Display name for this connection |
| Storage Account | Yes | Azure storage account name |
| Container | Yes | Blob container name (analogous to an SMB share) |
| Authentication | Yes | **Account Key** or **Connection String** |
| Account Key | If key auth | Azure storage account key |
| Connection String | If conn string auth | Full Azure storage connection string |

### Notes

- Access is scoped to a single container — you cannot reference blobs across containers in a single connection
- For move operations, FileBridge uses server-side copy (`BlobClient.beginCopyFromURL`) to avoid egress costs
- The host and port fields are not used for Azure Blob connections (the endpoint is derived from the account name)

---

## Connection Testing

Every connection has a **Test Connection** button available:

- In the **connection form** (before saving) — tests the form values directly via `POST /api/connections/test`
- In the **connection list** — tests an already-saved connection via `POST /api/connections/[id]/test`

The test verifies:
1. Network reachability (TCP connect to host:port)
2. Authentication (valid credentials)
3. Path access (can list the root/share)

A detailed success or failure message is shown in the UI.

---

## Built-in File Browser

FileBridge includes a full-featured file browser for interacting with any configured connection. Access it from the connections list or from the path fields in the job form.

### Navigating

- Click any directory to enter it; use the breadcrumb bar to navigate back up
- Files and folders are listed with name, size, and last modified date
- Click a folder in the job form's path picker to populate the path field

### File Operations

The file browser supports the following operations (admin role required):

| Operation | How |
|---|---|
| **Create Directory** | Click **New Folder**, enter a name, confirm |
| **Rename** | Click the `…` menu next to any entry → **Rename** |
| **Delete** | Click the `…` menu next to any file → **Delete** |

> **Note**: Directory deletion is not supported through the file browser — use your storage system's native tools for that operation.

### API Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/connections/[id]/browse?path=` | List directory contents |
| `POST /api/connections/[id]/mkdir` | Create a new directory |
| `DELETE /api/connections/[id]/files?path=` | Delete a file |
| `PATCH /api/connections/[id]/files` | Rename or move a file |

---

## Security

- Connection credentials are stored as JSON in the SQLite `connections.credentials` column
- API responses **never** return the `credentials` field — the connection list returns only `username` for display
- The edit form fetches full connection data via `GET /api/connections/[id]` (authenticated endpoint) — only the server ever has full credentials
- All credential fields are redacted (`[REDACTED]`) from structured log output

> **Planned**: Field-level encryption for credentials at rest using libsodium. See [Security](Security) and [Roadmap](Roadmap).

---

## Referential Integrity

A connection cannot be deleted if any job references it as its source or destination. The delete API returns an error listing the affected jobs. Update or delete those jobs first.
