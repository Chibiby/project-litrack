"use client";

import { useState } from "react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { ChevronDown, ChevronUp, Settings, UserCircle } from "lucide-react";
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
  /** `avatar`: initials circle and chevron, for the phone top bar (v2). */
  variant?: "default" | "avatar";
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

/**
 * Sidebar identity trigger with Profile and Settings. No Sign out here — the
 * sidebar renders its own Sign out button right under this trigger.
 */
export function UserAccountMenu({
  role,
  userName,
  roleLabel,
  className,
  side = "bottom",
  align = "end",
  collapsed = false,
  variant = "default",
}: UserAccountMenuProps) {
  const [open, setOpen] = useState(false);
  const Chevron = open ? ChevronUp : ChevronDown;

  const trigger = variant === "avatar" ? (
    <Button
      variant="ghost"
      className={cn("h-auto shrink-0 gap-1 rounded-full p-0.5 hover:bg-muted", className)}
      aria-label={`Account menu, ${userName}`}
    >
      <span
        aria-hidden
        className="flex size-10 items-center justify-center rounded-full bg-violet-200 text-sm font-semibold text-violet-800 dark:bg-violet-900/60 dark:text-violet-100"
      >
        {initialsOf(userName)}
      </span>
      <Chevron className="h-4 w-4 text-muted-foreground" aria-hidden />
    </Button>
  ) : (
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
          <PrefetchLink
            href={roleSettingsProfilePath(role)}
            prefetch={true}
            className="cursor-pointer"
          >
            <UserCircle className="h-4 w-4" />
            Profile
          </PrefetchLink>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <PrefetchLink
            href={roleSettingsPath(role)}
            prefetch={true}
            className="cursor-pointer"
          >
            <Settings className="h-4 w-4" />
            Settings
          </PrefetchLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
