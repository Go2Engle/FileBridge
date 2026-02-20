import { StatsCards } from "@/components/dashboard/stats-cards";
import { TransferChart } from "@/components/dashboard/transfer-chart";
import { ActivityFeed } from "@/components/dashboard/activity-feed";
import { JobStatusList } from "@/components/dashboard/job-status-list";

export const metadata = { title: "Dashboard — FileBridge" };

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm">
          Transfer engine overview and real-time metrics
        </p>
      </div>

      <StatsCards />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TransferChart />
        </div>
        <JobStatusList />
      </div>

      <ActivityFeed />
    </div>
  );
}
