"use client";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Copy, Download } from "lucide-react";
import { toast } from "sonner";
import { useRole } from "@/hooks/use-role";
import type { PgpKeyPublic } from "./pgp-key-list";

interface PgpKeyDetailProps {
  pgpKey: PgpKeyPublic | null;
  open: boolean;
  onClose: () => void;
}

export function PgpKeyDetail({ pgpKey, open, onClose }: PgpKeyDetailProps) {
  const { isAdmin } = useRole();

  if (!pgpKey) return null;

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }

  function exportKey(type: "public" | "private") {
    window.open(`/api/pgp-keys/${pgpKey!.id}/export?type=${type}`, "_blank");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{pgpKey.name}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {pgpKey.description && (
            <p className="text-sm text-muted-foreground">{pgpKey.description}</p>
          )}

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Type</p>
              <Badge variant={pgpKey.keyType === "keypair" ? "default" : "secondary"}>
                {pgpKey.keyType === "keypair" ? "Keypair" : "Public Only"}
              </Badge>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Algorithm</p>
              <p>{pgpKey.algorithm}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Created</p>
              <p>{pgpKey.keyCreatedAt ? new Date(pgpKey.keyCreatedAt).toLocaleDateString() : "Unknown"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Expires</p>
              <p>{pgpKey.keyExpiresAt ? new Date(pgpKey.keyExpiresAt).toLocaleDateString() : "Never"}</p>
            </div>
          </div>

          {pgpKey.userId && (
            <div>
              <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">User ID</p>
              <p className="text-sm">{pgpKey.userId}</p>
            </div>
          )}

          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">Fingerprint</p>
            <div className="flex items-center gap-2">
              <code className="text-xs font-mono bg-muted px-2 py-1 rounded break-all">
                {pgpKey.fingerprint}
              </code>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => copyToClipboard(pgpKey.fingerprint, "Fingerprint")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <Separator />

          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide mb-2">Public Key</p>
            <div className="relative">
              <pre className="text-xs font-mono bg-muted p-3 rounded max-h-[150px] overflow-auto whitespace-pre-wrap break-all">
                {pgpKey.publicKey}
              </pre>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-1 right-1 h-7 w-7"
                onClick={() => copyToClipboard(pgpKey.publicKey, "Public key")}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" size="sm" onClick={() => exportKey("public")}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export Public Key
          </Button>
          {isAdmin && pgpKey.keyType === "keypair" && (
            <Button variant="outline" size="sm" onClick={() => exportKey("private")}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export Private Key
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
