"use client";

import { useState } from "react";
import { HooksList } from "@/components/hooks/hooks-list";
import { LibraryBrowser } from "@/components/hooks/library-browser";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

export default function HooksPage() {
  const [libraryOpen, setLibraryOpen] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hooks</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Reusable webhook and shell actions that can be attached to jobs as pre- or post-transfer hooks.
          </p>
        </div>
        <Button variant="outline" onClick={() => setLibraryOpen(true)}>
          <BookOpen className="h-4 w-4 mr-2" />
          Browse Library
        </Button>
      </div>
      <HooksList />
      <LibraryBrowser open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </div>
  );
}
