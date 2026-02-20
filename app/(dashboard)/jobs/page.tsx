import { JobList } from "@/components/jobs/job-list";

export const metadata = { title: "Jobs — FileBridge" };

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        <p className="text-muted-foreground text-sm">
          Schedule and manage automated file transfer jobs
        </p>
      </div>
      <JobList />
    </div>
  );
}
