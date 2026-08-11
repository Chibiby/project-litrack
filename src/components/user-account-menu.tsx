"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronUp, Settings, UserCircle } from "lucide-react";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { logoutAction } from "@/lib/actions/auth";
import {
  roleSettingsPath,
  roleSettingsProfilePath,
  type AppRole,
} from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

interface UserAccountMenuProps {
  role: AppRole;
  userName: string;
  roleLabel: string;
  className?: string;
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
  /** Icons-only trigger for the collapsed desktop sidebar. */
  collapsed?: boolean;
}

/** Sidebar identity trigger with Profile, Settings, and Sign out. */
export function UserAccountMenu({
  role,
  userName,
  roleLabel,
  className,
  side = "bottom",
  align = "end",
  collapsed = false,
}: UserAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;

  const trigger = (
    <Button
      variant="ghost"
      className={cn(
        "h-auto rounded-md bg-primary/10 text-left shadow-none hover:bg-primary/15 focus-visible:ring-1 focus-visible:ring-border focus-visible:ring-offset-0",
        collapsed ? "justify-center px-2 py-2" : "gap-2 px-2.5 py-2",
        className
      )}
      aria-label={collapsed ? `Account menu, ${userName}` : "Account menu"}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
        <UserCircle className="h-4 w-4" />
      </div>
      {!collapsed && (
        <>
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <span className="truncate text-sm font-medium text-foreground">
              {userName}
            </span>
            <span className="truncate text-xs capitalize text-muted-foreground">
              {roleLabel}
            </span>
          </div>
          <Chevron
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </>
      )}
    </Button>
  );

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {collapsed ? (
        <Tooltip delayDuration={300} open={open ? false : undefined}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{userName}</TooltipContent>
        </Tooltip>
      ) : (
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      )}

      <DropdownMenuContent side={side} align={align} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
              <UserCircle className="h-4 w-4" />
            </div>
            <div className="flex min-w-0 flex-col overflow-hidden">
              <span className="truncate text-sm font-medium text-foreground">
                {userName}
              </span>
              <span className="truncate text-xs capitalize text-muted-foreground">
                {roleLabel}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link
            href={roleSettingsProfilePath(role)}
            prefetch={true}
            className="cursor-pointer"
          >
            <UserCircle className="h-4 w-4" />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link
            href={roleSettingsPath(role)}
            prefetch={true}
            className="cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <form action={logoutAction}>
          <SignOutButton className="w-full justify-start px-2" />
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
