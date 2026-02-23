"use client";

import { useSession } from "next-auth/react";

export function useRole() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? "viewer";
  const isAdmin = role === "admin";
  return { role, isAdmin };
}
