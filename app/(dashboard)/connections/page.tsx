"use client";

import { useState } from "react";
import { ConnectionList } from "@/components/connections/connection-list";
import { ConnectionForm } from "@/components/connections/connection-form";
import type { Connection } from "@/lib/db/schema";

export default function ConnectionsPage() {
  const [formOpen, setFormOpen] = useState(false);
  const [editConnection, setEditConnection] = useState<Connection | null>(null);

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
          setEditConnection(null);
          setFormOpen(true);
        }}
        onEdit={(conn) => {
          setEditConnection(conn);
          setFormOpen(true);
        }}
      />

      <ConnectionForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditConnection(null);
        }}
        editConnection={editConnection}
      />
    </div>
  );
}
