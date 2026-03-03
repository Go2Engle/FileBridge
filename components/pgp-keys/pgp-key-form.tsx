"use client";

import { useEffect, useState, useRef } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Eye, EyeOff, Upload } from "lucide-react";
import type { PgpKeyPublic } from "./pgp-key-list";

// ---------- Schemas ----------

const generateSchema = z.object({
  mode: z.literal("generate"),
  name: z.string().min(1, "Name is required"),
  algorithm: z.enum(["rsa4096", "ecc-curve25519"]),
  email: z.string().optional(),
  passphrase: z.string().optional(),
  expirationDays: z.coerce.number().int().min(0).default(0),
});

const importSchema = z.object({
  mode: z.literal("import"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  publicKey: z.string().min(1, "Public key is required"),
  privateKey: z.string().optional(),
  passphrase: z.string().optional(),
});

const editSchema = z.object({
  mode: z.literal("edit"),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

const formSchema = z.discriminatedUnion("mode", [generateSchema, importSchema, editSchema]);
type FormValues = z.infer<typeof formSchema>;

// ---------- Component ----------

interface PgpKeyFormProps {
  open: boolean;
  onClose: () => void;
  editKey: PgpKeyPublic | null;
}

export function PgpKeyForm({ open, onClose, editKey }: PgpKeyFormProps) {
  const isEditing = !!editKey;
  const queryClient = useQueryClient();
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [tab, setTab] = useState<"generate" | "import">("generate");
  const pubFileRef = useRef<HTMLInputElement>(null);
  const privFileRef = useRef<HTMLInputElement>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema) as Resolver<FormValues>,
    defaultValues: {
      mode: "generate" as const,
      name: "",
      algorithm: "ecc-curve25519",
      email: "",
      passphrase: "",
      expirationDays: 0,
    },
  });

  useEffect(() => {
    if (!open) return;
    setShowPassphrase(false);
    if (editKey) {
      form.reset({
        mode: "edit" as const,
        name: editKey.name,
        description: editKey.description ?? "",
      });
    } else {
      setTab("generate");
      form.reset({
        mode: "generate" as const,
        name: "",
        algorithm: "ecc-curve25519",
        email: "",
        passphrase: "",
        expirationDays: 0,
      });
    }
  }, [open, editKey, form]);

  // Sync tab change to form mode
  useEffect(() => {
    if (isEditing) return;
    if (tab === "generate") {
      form.reset({
        mode: "generate" as const,
        name: form.getValues("name") || "",
        algorithm: "ecc-curve25519",
        email: "",
        passphrase: "",
        expirationDays: 0,
      });
    } else {
      form.reset({
        mode: "import" as const,
        name: form.getValues("name") || "",
        description: "",
        publicKey: "",
        privateKey: "",
        passphrase: "",
      });
    }
  }, [tab, isEditing, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      if (values.mode === "edit") {
        return axios.put(`/api/pgp-keys/${editKey!.id}`, {
          name: values.name,
          description: values.description,
        });
      } else if (values.mode === "generate") {
        return axios.post("/api/pgp-keys", {
          action: "generate",
          name: values.name,
          algorithm: values.algorithm,
          email: values.email || undefined,
          passphrase: values.passphrase || undefined,
          expirationDays: values.expirationDays || 0,
        });
      } else {
        return axios.post("/api/pgp-keys", {
          action: "import",
          name: values.name,
          description: values.description || undefined,
          publicKey: values.publicKey,
          privateKey: values.privateKey || undefined,
          passphrase: values.passphrase || undefined,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pgp-keys"] });
      toast.success(
        isEditing ? "PGP key updated" : "PGP key created"
      );
      onClose();
    },
    onError: (err) => {
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string })?.error ?? "Failed to save"
        : "Failed to save";
      toast.error(message);
    },
  });

  function handleFileRead(
    file: File,
    field: "publicKey" | "privateKey"
  ) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      form.setValue(field as never, content as never, { shouldValidate: true });
    };
    reader.readAsText(file);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit PGP Key" : "New PGP Key"}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(85vh-10rem)] -mx-6 px-6">
          <Form {...form}>
            <form
              id="pgp-key-form"
              onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
              className="space-y-4 pb-4"
            >
              {isEditing ? (
                /* Edit mode — just name and description */
                <>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name</FormLabel>
                        <FormControl>
                          <Input placeholder="My PGP Key" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Input placeholder="Optional description" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </>
              ) : (
                /* Create mode — tabs for generate vs import */
                <>
                  <Tabs value={tab} onValueChange={(v) => setTab(v as "generate" | "import")}>
                    <TabsList className="w-full">
                      <TabsTrigger value="generate" className="flex-1">Generate</TabsTrigger>
                      <TabsTrigger value="import" className="flex-1">Import</TabsTrigger>
                    </TabsList>

                    <TabsContent value="generate" className="space-y-4 mt-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name</FormLabel>
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
                            <Select onValueChange={field.onChange} value={field.value as string}>
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
                              <Input
                                placeholder="user@example.com"
                                type="email"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Embedded in the key's user ID for identification.
                            </FormDescription>
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
                    </TabsContent>

                    <TabsContent value="import" className="space-y-4 mt-4">
                      <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                              <Input placeholder="Imported Key" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Description (optional)</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Partner's public key" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="publicKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Public Key</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----&#10;...&#10;-----END PGP PUBLIC KEY BLOCK-----"
                                className="font-mono text-xs min-h-[120px]"
                                {...field}
                              />
                            </FormControl>
                            <div className="flex items-center gap-2 mt-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => pubFileRef.current?.click()}
                              >
                                <Upload className="h-3 w-3 mr-1" />
                                Upload .asc
                              </Button>
                              <input
                                ref={pubFileRef}
                                type="file"
                                accept=".asc,.gpg,.txt,.pub"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleFileRead(f, "publicKey");
                                }}
                              />
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="privateKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Private Key (optional)</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----&#10;...&#10;-----END PGP PRIVATE KEY BLOCK-----"
                                className="font-mono text-xs min-h-[120px]"
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>
                              Only needed if you want to decrypt files with this key.
                            </FormDescription>
                            <div className="flex items-center gap-2 mt-1">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => privFileRef.current?.click()}
                              >
                                <Upload className="h-3 w-3 mr-1" />
                                Upload .asc
                              </Button>
                              <input
                                ref={privFileRef}
                                type="file"
                                accept=".asc,.gpg,.txt,.key"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleFileRead(f, "privateKey");
                                }}
                              />
                            </div>
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
                                  placeholder="Private key passphrase"
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
                    </TabsContent>
                  </Tabs>
                </>
              )}
            </form>
          </Form>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="pgp-key-form"
            disabled={mutation.isPending}
          >
            {mutation.isPending
              ? isEditing ? "Saving..." : "Creating..."
              : isEditing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
