import { NotificationSettings } from "@/components/settings/notification-settings";
import { PurgeLogsSettings } from "@/components/settings/purge-logs-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { TimezoneSettings } from "@/components/settings/timezone-settings";
import { Separator } from "@/components/ui/separator";

export const metadata = { title: "Settings — FileBridge" };

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Configure notifications, alerting rules, and data management
        </p>
      </div>
      <TimezoneSettings />
      <Separator />
      <NotificationSettings />
      <Separator />
      <BackupSettings />
      <Separator />
      <PurgeLogsSettings />
    </div>
  );
}
