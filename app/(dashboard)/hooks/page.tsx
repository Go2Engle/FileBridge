"use client";

import { HooksList } from "@/components/hooks/hooks-list";

export default function HooksPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Hooks</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Reusable webhook and shell actions that can be attached to jobs as pre- or post-transfer hooks.
        </p>
      </div>
      <HooksList />
    </div>
  );
}
