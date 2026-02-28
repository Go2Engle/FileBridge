import { NotificationSettings } from "@/components/settings/notification-settings";
import { PurgeLogsSettings } from "@/components/settings/purge-logs-settings";
import { BackupSettings } from "@/components/settings/backup-settings";
import { GeneralSettings } from "@/components/settings/general-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
      <Tabs defaultValue="general">
        <TabsList className="mb-4">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="data">Data Management</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <GeneralSettings />
        </TabsContent>

        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <BackupSettings />
          <PurgeLogsSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
