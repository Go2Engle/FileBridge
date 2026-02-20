import { LogTable } from "@/components/logs/log-table";

export const metadata = { title: "Logs — FileBridge" };

export default function LogsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>
        <p className="text-muted-foreground text-sm">
          Complete transfer history and audit trail
        </p>
      </div>
      <LogTable />
    </div>
  );
}
