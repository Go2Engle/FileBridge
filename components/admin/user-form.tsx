"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const createSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Only letters, numbers, dots, hyphens, underscores"),
  displayName: z.string().min(1, "Required").max(100),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  role: z.enum(["admin", "viewer"]),
  isLocal: z.boolean(),
  password: z.string().optional(),
  isActive: z.boolean(),
});

type FormValues = z.infer<typeof createSchema>;

interface UserFormDialogProps {
  open: boolean;
  onClose: () => void;
  editUser: {
    id: number;
    username: string;
    displayName: string;
    email: string | null;
    role: "admin" | "viewer";
    isLocal: boolean;
    isActive: boolean;
  } | null;
}

export function UserFormDialog({ open, onClose, editUser }: UserFormDialogProps) {
  const queryClient = useQueryClient();
  const isEdit = !!editUser;

  const form = useForm<FormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      username: "",
      displayName: "",
      email: "",
      role: "viewer",
      isLocal: true,
      password: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (editUser) {
      form.reset({
        username: editUser.username,
        displayName: editUser.displayName,
        email: editUser.email ?? "",
        role: editUser.role,
        isLocal: editUser.isLocal,
        password: "",
        isActive: editUser.isActive,
      });
    } else {
      form.reset({
        username: "",
        displayName: "",
        email: "",
        role: "viewer",
        isLocal: true,
        password: "",
        isActive: true,
      });
    }
  }, [editUser, form]);

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      const url = isEdit
        ? `/api/admin/users/${editUser.id}`
        : "/api/admin/users";
      const method = isEdit ? "PUT" : "POST";

      const body: Record<string, unknown> = { ...values };
      if (!values.isLocal || (isEdit && !values.password)) {
        delete body.password;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Operation failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast.success(isEdit ? "User updated" : "User created");
      onClose();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const isLocal = form.watch("isLocal");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User" : "Create User"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((v) => mutation.mutate(v))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isEdit} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Display Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="admin">Administrator</SelectItem>
                      <SelectItem value="viewer">Viewer (Read-only)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {!isEdit && (
              <FormField
                control={form.control}
                name="isLocal"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>Local Authentication</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Uncheck for SSO-only users
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {(isLocal || isEdit) && (
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {isEdit ? "New Password" : "Password"}
                      {isEdit && (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          (leave blank to keep)
                        </span>
                      )}
                    </FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {isEdit && (
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <FormLabel>Active</FormLabel>
                      <p className="text-xs text-muted-foreground">
                        Inactive users cannot sign in
                      </p>
                    </div>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isEdit ? "Updating..." : "Creating..."}
                </>
              ) : isEdit ? (
                "Update User"
              ) : (
                "Create User"
              )}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
