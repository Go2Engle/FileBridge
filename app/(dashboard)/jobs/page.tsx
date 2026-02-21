"use client";

import { useState } from "react";
import { JobList } from "@/components/jobs/job-list";
import { JobForm } from "@/components/jobs/job-form";
import { JobDetailSheet } from "@/components/jobs/job-detail-sheet";
import type { Job } from "@/lib/db/schema";

export default function JobsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

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
        onSelect={(job) => setSelectedJob(job)}
      />

      <JobForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditJob(null);
        }}
        editJob={editJob}
      />

      <JobDetailSheet
        job={selectedJob}
        open={!!selectedJob}
        onClose={() => setSelectedJob(null)}
        onEdit={(job) => {
          setSelectedJob(null);
          setEditJob(job);
          setFormOpen(true);
        }}
      />
    </div>
  );
}
