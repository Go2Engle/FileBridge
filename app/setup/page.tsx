"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const setupSchema = z
  .object({
    username: z
      .string()
      .min(3, "Username must be at least 3 characters")
      .max(50)
      .regex(
        /^[a-zA-Z0-9_.-]+$/,
        "Only letters, numbers, dots, hyphens, and underscores"
      ),
    displayName: z.string().min(1, "Display name is required").max(100),
    email: z.string().email("Invalid email").optional().or(z.literal("")),
    password: z
      .string()
      .min(8, "Must be at least 8 characters")
      .regex(/[a-z]/, "Must contain a lowercase letter")
      .regex(/[A-Z]/, "Must contain an uppercase letter")
      .regex(/[0-9]/, "Must contain a number"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type SetupFormValues = z.infer<typeof setupSchema>;

export default function SetupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"welcome" | "create" | "complete">(
    "welcome"
  );

  const { isLoading: checkingStatus } = useQuery({
    queryKey: ["setup-status"],
    queryFn: async () => {
      const res = await fetch("/api/setup/status");
      const data = await res.json();
      if (!data.needsSetup) {
        router.replace("/login");
      }
      return data;
    },
  });

  const form = useForm<SetupFormValues>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      username: "",
      displayName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  const createAdmin = useMutation({
    mutationFn: async (values: SetupFormValues) => {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Setup failed");
      }
      return res.json();
    },
    onSuccess: () => {
      setStep("complete");
      queryClient.setQueryData(["setup-status"], { needsSetup: false });
      setTimeout(() => router.push("/login"), 2000);
    },
  });

  if (checkingStatus) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ArrowLeftRight className="h-6 w-6" />
        </div>
        <CardTitle className="text-2xl">
          {step === "welcome" && "Welcome to FileBridge"}
          {step === "create" && "Create Administrator Account"}
          {step === "complete" && "Setup Complete"}
        </CardTitle>
        <CardDescription>
          {step === "welcome" &&
            "Automated file transfer scheduling and monitoring. Let's get you set up."}
          {step === "create" &&
            "Create your first administrator account to get started."}
          {step === "complete" && "Your admin account has been created."}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {step === "welcome" && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4 text-sm text-muted-foreground space-y-2">
              <p>This wizard will help you:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Create a local administrator account</li>
                <li>Get started managing file transfers</li>
              </ul>
              <p className="pt-1">
                You can configure external SSO providers (Azure AD, GitHub)
                later from the admin settings.
              </p>
            </div>
            <Button className="w-full" onClick={() => setStep("create")}>
              Get Started
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {step === "create" && (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((values) =>
                createAdmin.mutate(values)
              )}
              className="space-y-4"
            >
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="admin" {...field} />
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
                      <Input placeholder="Administrator" {...field} />
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
                    <FormLabel>
                      Email{" "}
                      <span className="text-muted-foreground">(optional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm Password</FormLabel>
                    <FormControl>
                      <Input type="password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {createAdmin.error && (
                <p className="text-sm text-destructive">
                  {createAdmin.error.message}
                </p>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={createAdmin.isPending}
              >
                {createAdmin.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Account...
                  </>
                ) : (
                  "Create Admin Account"
                )}
              </Button>
            </form>
          </Form>
        )}

        {step === "complete" && (
          <div className="flex flex-col items-center space-y-4 py-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
              <Check className="h-6 w-6" />
            </div>
            <p className="text-sm text-muted-foreground">
              Redirecting to login...
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
