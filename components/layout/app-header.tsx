"use client";

import { BellIcon, SparklesIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { useCommand } from "@/hooks/use-church-data";
import { useNotifications } from "@/hooks/useNotifications";
import { CommandPalette } from "./command-palette";
import { QuickActions } from "./quick-actions";
import { RoleSwitcher } from "./role-switcher";

/** Top bar: search, reminders, undo, role switching and quick actions. */
export function AppHeader() {
  const { mine, notifyDueToday } = useNotifications();
  const { undo, canUndo, undoLabel } = useCommand();
  const outstanding = mine.dueToday.length + mine.overdue.length;

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-1.5 border-b bg-background/95 px-3 backdrop-blur sm:gap-2 sm:px-4 lg:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 h-5" />

      <div className="min-w-0 flex-1">
        <CommandPalette />
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={notifyDueToday}
              aria-label={`Reminders: ${outstanding} items need attention`}
              className="relative"
            >
              <BellIcon />
              {outstanding ? (
                <Badge
                  variant="destructive"
                  className="absolute -top-1 -right-1 h-4 min-w-4 px-1 text-[10px]"
                >
                  {outstanding}
                </Badge>
              ) : null}
            </Button>
          }
        />
        <TooltipContent>
          {outstanding
            ? `${mine.dueToday.length} due today, ${mine.overdue.length} overdue`
            : "Nothing due for you"}
        </TooltipContent>
      </Tooltip>

      {canUndo ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" onClick={undo} aria-label="Undo last change">
                <Undo2Icon />
              </Button>
            }
          />
          <TooltipContent>Undo {undoLabel}</TooltipContent>
        </Tooltip>
      ) : null}

      <Tooltip>
        <TooltipTrigger
          render={
            <LinkButton
              variant="ghost"
              size="icon-sm"
              aria-label="Guided demo"
              href="/demo"
              className="hidden sm:inline-flex"
            >
              <SparklesIcon />
            </LinkButton>
          }
        />
        <TooltipContent>Guided demo</TooltipContent>
      </Tooltip>

      <RoleSwitcher />
      <QuickActions />
    </header>
  );
}
