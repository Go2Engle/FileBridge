import { AuditLogTable } from "@/components/audit/audit-log-table";

export const metadata = { title: "Audit Log — FileBridge" };

export default function AuditLogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Log</h1>
        <p className="text-muted-foreground text-sm">
          All user actions, job executions, and system events
        </p>
      </div>
      <AuditLogTable />
    </div>
  );
}
