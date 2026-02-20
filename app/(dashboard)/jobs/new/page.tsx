import { JobForm } from "@/components/jobs/job-form";

export const metadata = { title: "New Job — FileBridge" };

export default function NewJobPage() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Job</h1>
        <p className="text-muted-foreground text-sm">
          Configure a scheduled file transfer job
        </p>
      </div>
      <JobForm />
    </div>
  );
}
