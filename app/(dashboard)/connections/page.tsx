"use client";

import { useState } from "react";
import { ConnectionList } from "@/components/connections/connection-list";
import { ConnectionForm } from "@/components/connections/connection-form";

export default function ConnectionsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editConnectionId, setEditConnectionId] = useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
        <p className="text-muted-foreground text-sm">
          Manage SFTP and SMB connection profiles
        </p>
      </div>

      <ConnectionList
        onNew={() => {
          setEditConnectionId(null);
          setFormOpen(true);
        }}
        onEdit={(conn) => {
          setEditConnectionId(conn.id);
          setFormOpen(true);
        }}
      />

      <ConnectionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditConnectionId(null);
        }}
        editConnection={editConnectionId !== null ? { id: editConnectionId } : null}
      />
    </div>
  );
}
