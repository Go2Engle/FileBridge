"use client";

import { useSession, signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut } from "lucide-react";

const DEV_BYPASS =
  process.env.NEXT_PUBLIC_AUTH_BYPASS_DEV === "true" &&
  process.env.NODE_ENV === "development";

const DEV_USER = {
  name: "Dev User",
  email: "dev@localhost",
  image: null,
  role: "admin" as const,
};

export function AuthButton() {
  const { data: session } = useSession();

  const user = DEV_BYPASS ? DEV_USER : session?.user;

  if (!user) return null;

  const initials = user.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : user.email?.[0].toUpperCase() ?? "U";

  const role = "role" in user ? user.role : undefined;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
          <Avatar className="h-8 w-8 cursor-pointer">
            <AvatarImage src={user.image ?? undefined} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{user.name}</span>
              {role && (
                <Badge
                  variant={role === "admin" ? "default" : "secondary"}
                  className="text-[10px] px-1.5 py-0"
                >
                  {role}
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground truncate">
              {user.email}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DEV_BYPASS ? (
          <DropdownMenuItem disabled className="text-muted-foreground">
            <LogOut className="h-4 w-4" />
            Sign out (dev bypass)
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-destructive focus:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
