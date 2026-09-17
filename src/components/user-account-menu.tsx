"use client";

import { useState } from "react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { ChevronDown, ChevronUp, LogOut, Settings, UserCircle } from "lucide-react";
import { logoutAction } from "@/lib/actions/auth";
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
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";

interface UserAccountMenuProps {
  role: AppRole;
  userName: string;
  avatarPath: string | null;
  roleLabel: string;
  className?: string;
  side?: "top" | "bottom";
  align?: "start" | "end" | "center";
  /** Icons-only trigger for the collapsed desktop sidebar. */
  collapsed?: boolean;
  /** `avatar`: initials circle and chevron, for the phone top bar (v2). */
  variant?: "default" | "avatar";
}

/**
 * Identity trigger with Profile and Settings. The sidebar variant has no Sign
 * out — the sidebar renders its own button right under it. The `avatar`
 * variant (phone top bar) adds Sign out, since the phone drawer has none.
 */
export function UserAccountMenu({
  role,
  userName,
  avatarPath,
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
      <UserAvatar name={userName} avatarPath={avatarPath} size={40} variant="thumb" />
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
      <UserAvatar name={userName} avatarPath={avatarPath} size={32} variant="thumb" fallback="icon" />
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
            <UserAvatar name={userName} avatarPath={avatarPath} size={32} variant="thumb" fallback="icon" />
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

        {/* The phone top bar is the only account surface on phones (the drawer
            has none), so Sign out lives here for that variant. */}
        {variant === "avatar" ? (
          <>
            <DropdownMenuSeparator />
            {/* Called directly rather than via a submit button: the menu closes
                on select and would unmount a form before it submitted. */}
            <DropdownMenuItem
              onSelect={() => {
                void logoutAction();
              }}
              className="cursor-pointer text-red-700 focus:text-red-700 dark:text-red-400 dark:focus:text-red-400"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
