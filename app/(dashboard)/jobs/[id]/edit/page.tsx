import { db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { JobForm } from "@/components/jobs/job-form";

export const metadata = { title: "Edit Job — FileBridge" };

export default async function EditJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await db.query.jobs.findFirst({ where: eq(jobs.id, Number(id)) });
  if (!job) notFound();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Edit Job</h1>
        <p className="text-muted-foreground text-sm">
          Update the configuration for &quot;{job.name}&quot;
        </p>
      </div>
      <JobForm job={job} />
    </div>
  );
}
