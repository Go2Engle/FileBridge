# Extending FileBridge

FileBridge is designed with extensibility as a first-class concern. Adding new storage protocols, post-transfer actions, or notification channels requires changes to a small number of focused files and no modifications to the core transfer engine or scheduler.

---

## Adding a New Storage Provider

A storage provider implements the `StorageProvider` interface defined in `lib/storage/interface.ts`. Once implemented, it integrates automatically with the transfer engine, file browser, connection testing, and dry-run system.

### Step 1 — Create the Provider Class

Create `lib/storage/s3.ts` (or `ftp.ts`, `gcs.ts`, etc.):

```typescript
import { StorageProvider, FileInfo } from "./interface";

interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

export class S3Provider implements StorageProvider {
  private client: S3Client; // e.g. @aws-sdk/client-s3

  constructor(private credentials: S3Credentials) {}

  async connect(): Promise<void> {
    this.client = new S3Client({
      region: this.credentials.region,
      credentials: {
        accessKeyId: this.credentials.accessKeyId,
        secretAccessKey: this.credentials.secretAccessKey,
      },
    });
  }

  async disconnect(): Promise<void> {
    // S3 client is stateless — nothing to close
  }

  async listFiles(path: string, filter?: string): Promise<FileInfo[]> {
    // List objects with the given prefix
    // Apply glob filter using globToRegex from interface.ts
    // Return FileInfo[] with name, size, modifiedAt, isDirectory: false
  }

  async listDirectory(path: string): Promise<FileInfo[]> {
    // Like listFiles but also include "directory" prefixes
  }

  async downloadFile(remotePath: string): Promise<Buffer> {
    // GetObjectCommand → collect stream → return Buffer
  }

  async uploadFile(content: Buffer, remotePath: string): Promise<void> {
    // PutObjectCommand
  }

  async deleteFile(remotePath: string): Promise<void> {
    // DeleteObjectCommand
  }

  async moveFile(sourcePath: string, destinationPath: string): Promise<void> {
    // CopyObjectCommand + DeleteObjectCommand (or server-side copy)
  }
}
```

### Step 2 — Register the Provider

Add a case in `lib/storage/registry.ts`:

```typescript
import { S3Provider } from "./s3";

export function createStorageProvider(connection: Connection): StorageProvider {
  switch (connection.protocol) {
    case "sftp":   return new SftpProvider(connection);
    case "smb":    return new SmbProvider(connection);
    case "azure-blob": return new AzureBlobProvider(connection);
    case "s3":     return new S3Provider(connection.credentials as S3Credentials); // add this
    default:
      throw new Error(`Unknown protocol: ${connection.protocol}`);
  }
}
```

### Step 3 — Add the Protocol to the DB Schema

In `lib/db/schema.ts`, extend the `protocol` enum:

```typescript
protocol: text("protocol", {
  enum: ["sftp", "smb", "azure-blob", "s3"]  // add "s3"
}).notNull(),
```

### Step 4 — Update the Connection Form UI

In `components/connections/connection-form.tsx`:

1. Add `"s3"` to the protocol selector options
2. Add credential fields for the new protocol (conditionally rendered based on selected protocol)
3. Map the form fields to the `credentials` JSON object

### Step 5 — Add to next.config.ts (if needed)

If the new provider uses a native Node.js module, add it to `serverExternalPackages`:

```typescript
// next.config.ts
serverExternalPackages: ["better-sqlite3", "ssh2-sftp-client", "v9u-smb2", "@aws-sdk/client-s3"]
```

### That's It

The transfer engine, scheduler, dry-run system, connection tester, and file browser all work with the new provider automatically — no changes required in any of those files.

---

## Adding a New Post-Transfer Action

Post-transfer actions control what happens to the source file after a successful transfer.

### Step 1 — Extend the Schema Enum

In `lib/db/schema.ts`:

```typescript
postTransferAction: text("post_transfer_action", {
  enum: ["retain", "delete", "move", "archive"]  // add "archive"
}).notNull().default("retain"),
```

### Step 2 — Handle It in the Engine

In `lib/transfer/engine.ts`, find the post-transfer action block and add a case:

```typescript
if (job.postTransferAction === "delete") {
  await source.deleteFile(srcFilePath);
} else if (job.postTransferAction === "move" && job.movePath) {
  await source.moveFile(srcFilePath, path.posix.join(job.movePath, file.name));
} else if (job.postTransferAction === "archive") {
  // your custom logic here
}
```

### Step 3 — Add the Option to the Job Form

In `components/jobs/job-form.tsx`, add the new action to the select field options.

---

## Adding a New Notification Channel

The settings system uses a flexible key-value store. Notification settings are stored as JSON under the `"notifications"` key.

### Step 1 — Extend the Settings Schema

In `app/api/settings/route.ts`, add your new channel's fields to the settings object being read and written.

### Step 2 — Add the UI Tab

In `components/settings/notification-settings.tsx`, add a new tab or section for the new channel (e.g. Slack webhook, PagerDuty API key).

### Step 3 — Wire Up Dispatch

In the transfer engine (`lib/transfer/engine.ts`), in the error handling block, read the notification settings and trigger your new channel. A `sendNotification(channel, message)` abstraction would be a natural place to put this logic.

---

## Adding a New Dashboard Widget

The dashboard data is served from `app/api/dashboard/stats/route.ts`. To add a new KPI:

1. Add the query to the stats API route
2. Add the new field to the response JSON
3. Create a new card component in `components/dashboard/`
4. Add it to the dashboard page layout

---

## Contributing Patterns

When adding new features, follow these conventions used throughout the codebase:

### Logging

```typescript
import { createLogger } from "@/lib/logger";
const log = createLogger("my-component");

log.info("Something happened", { key: "value" });
log.error("Something failed", { error: err });
```

Never use `console.log` in server-side code (except in `lib/auth/config.ts` which runs in the Edge runtime).

### Audit Logging

For any action that creates, modifies, or deletes user data:

```typescript
import { logAudit, getIpFromRequest, getUserId } from "@/lib/audit";

await logAudit({
  userId: getUserId(session),
  action: "create",
  resource: "connection",
  resourceId: newConnection.id,
  resourceName: newConnection.name,
  ipAddress: getIpFromRequest(request),
  details: { protocol: newConnection.protocol },
});
```

### API Route Pattern

```typescript
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const data = await db.query.myTable.findMany();
    return NextResponse.json(data);
  } catch (err) {
    log.error("Failed to fetch data", { error: err });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```
