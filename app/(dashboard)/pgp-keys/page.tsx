"use client";

import { PgpKeyList } from "@/components/pgp-keys/pgp-key-list";

export default function PgpKeysPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PGP Keys</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage PGP keys for encrypting and decrypting transferred files.
        </p>
      </div>
      <PgpKeyList />
    </div>
  );
}
