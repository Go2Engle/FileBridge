"use client";

import { useState } from "react";
import { JobList } from "@/components/jobs/job-list";
import { JobForm } from "@/components/jobs/job-form";
import type { Job } from "@/lib/db/schema";

export default function JobsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
        <p className="text-muted-foreground text-sm">
          Schedule and manage automated file transfer jobs
        </p>
      </div>

      <JobList
        onNew={() => {
          setEditJob(null);
          setFormOpen(true);
        }}
        onEdit={(job) => {
          setEditJob(job);
          setFormOpen(true);
        }}
      />

      <JobForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditJob(null);
        }}
        editJob={editJob}
      />
    </div>
  );
}
