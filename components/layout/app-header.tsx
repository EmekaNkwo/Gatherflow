"use client";

import Link from "next/link";
import { BellIcon, CircleUserIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSnapshot } from "@/hooks/use-church-data";
import { useNotifications } from "@/hooks/useNotifications";
import { BrandMark } from "./brand-mark";
import { CommandPalette } from "./command-palette";
import { QuickActions } from "./quick-actions";

/**
 * Top bar. On a phone it is just the church, search and your account — the
 * tab bar at the bottom does the rest. From medium screens up it adds the
 * reminders bell and the "New" menu. Switching church lives in the menu.
 */
export function AppHeader() {
  const { mine, notifyDueToday } = useNotifications();
  const snapshot = useSnapshot();
  const outstanding = mine.dueToday.length + mine.overdue.length;

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-6">
      <SidebarTrigger className="-ml-1 hidden md:inline-flex" />
      <Separator orientation="vertical" className="mr-1 hidden h-5 md:block" />

      <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5 md:hidden">
        <BrandMark className="size-8" />
        <span className="truncate font-heading text-lg">{snapshot.settings.churchName}</span>
      </Link>

      <div className="flex items-center md:min-w-0 md:flex-1">
        <CommandPalette />
      </div>

      <div className="hidden items-center gap-1.5 md:flex">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={notifyDueToday}
                aria-label={`Reminders: ${outstanding} waiting for you`}
                className="relative"
              >
                <BellIcon />
                {outstanding ? (
                  <Badge className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]">{outstanding}</Badge>
                ) : null}
              </Button>
            }
          />
          <TooltipContent>
            {outstanding ? `${mine.dueToday.length} due today, ${mine.overdue.length} overdue` : "Nothing waiting for you"}
          </TooltipContent>
        </Tooltip>

        <QuickActions />
      </div>

      <LinkButton variant="ghost" size="icon-lg" aria-label="Your account" href="/account" className="rounded-full">
        <CircleUserIcon className="size-5" />
      </LinkButton>
    </header>
  );
}
