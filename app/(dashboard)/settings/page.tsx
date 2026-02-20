import { NotificationSettings } from "@/components/settings/notification-settings";

export const metadata = { title: "Settings — FileBridge" };

export default function SettingsPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm">
          Configure notifications and alerting rules
        </p>
      </div>
      <NotificationSettings />
    </div>
  );
}
