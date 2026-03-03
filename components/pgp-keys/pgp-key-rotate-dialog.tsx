"use client";

import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Eye, EyeOff, RefreshCw } from "lucide-react";
import type { PgpKeyPublic } from "./pgp-key-list";

const rotateSchema = z.object({
  name: z.string().min(1, "Name is required"),
  algorithm: z.enum(["rsa4096", "ecc-curve25519"]),
  email: z.string().optional(),
  passphrase: z.string().optional(),
  expirationDays: z.coerce.number().int().min(0).default(0),
});

type RotateFormValues = z.infer<typeof rotateSchema>;

interface PgpKeyRotateDialogProps {
  open: boolean;
  onClose: () => void;
  sourceKey: PgpKeyPublic | null;
}

function mapAlgorithm(algo: string): "rsa4096" | "ecc-curve25519" {
  if (algo.startsWith("rsa")) return "rsa4096";
  return "ecc-curve25519";
}

export function PgpKeyRotateDialog({ open, onClose, sourceKey }: PgpKeyRotateDialogProps) {
  const queryClient = useQueryClient();
  const [showPassphrase, setShowPassphrase] = useState(false);

  const form = useForm<RotateFormValues>({
    resolver: zodResolver(rotateSchema) as Resolver<RotateFormValues>,
    defaultValues: {
      name: "",
      algorithm: "ecc-curve25519",
      email: "",
      passphrase: "",
      expirationDays: 0,
    },
  });

  useEffect(() => {
    if (!open || !sourceKey) return;
    setShowPassphrase(false);
    form.reset({
      name: `${sourceKey.name} (rotated)`,
      algorithm: mapAlgorithm(sourceKey.algorithm),
      email: "",
      passphrase: "",
      expirationDays: 0,
    });
  }, [open, sourceKey, form]);

  const mutation = useMutation({
    mutationFn: async (values: RotateFormValues) => {
      const res = await axios.post(`/api/pgp-keys/${sourceKey!.id}/rotate`, {
        name: values.name,
        algorithm: values.algorithm,
        email: values.email || undefined,
        passphrase: values.passphrase || undefined,
        expirationDays: values.expirationDays || 0,
      });
      return res.data as { newKey: PgpKeyPublic; updatedJobCount: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["pgp-keys"] });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      const msg = data.updatedJobCount > 0
        ? `Key rotated. ${data.updatedJobCount} job${data.updatedJobCount !== 1 ? "s" : ""} updated to use the new key.`
        : "Key rotated successfully.";
      toast.success(msg);
      onClose();
    },
    onError: (err) => {
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string })?.error ?? "Failed to rotate key"
        : "Failed to rotate key";
      toast.error(message);
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Rotate Key
          </DialogTitle>
        </DialogHeader>

        {sourceKey && (
          <Alert>
            <AlertDescription>
              A new key will be generated to replace <strong>{sourceKey.name}</strong>.
              All jobs using the old key will be automatically updated.
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form
            id="pgp-key-rotate-form"
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New Key Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My PGP Key" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="algorithm"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Algorithm</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="ecc-curve25519">ECC Curve25519 (Recommended)</SelectItem>
                      <SelectItem value="rsa4096">RSA 4096</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    ECC is faster and produces smaller keys. RSA 4096 is widely compatible.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="user@example.com" type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="passphrase"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Passphrase (optional)</FormLabel>
                  <div className="relative">
                    <FormControl>
                      <Input
                        type={showPassphrase ? "text" : "password"}
                        placeholder="Optional passphrase for private key"
                        autoComplete="new-password"
                        className="pr-8"
                        {...field}
                      />
                    </FormControl>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 h-7 w-7"
                      onClick={() => setShowPassphrase((s) => !s)}
                    >
                      {showPassphrase ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="expirationDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Expiration</FormLabel>
                  <Select
                    onValueChange={(v) => field.onChange(Number(v))}
                    value={String(field.value)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="0">Never</SelectItem>
                      <SelectItem value="365">1 year</SelectItem>
                      <SelectItem value="730">2 years</SelectItem>
                      <SelectItem value="1825">5 years</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="pgp-key-rotate-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Rotating..." : "Rotate Key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
