"use client";

import { ShieldAlertIcon, UserCogIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useDemoRole } from "@/hooks/useDemoRole";
import { DEMO_ROLES, DEMO_ROLE_DESCRIPTIONS, DEMO_ROLE_LABELS } from "@/types/team";

/**
 * Lets a reviewer inspect the interface each role sees.
 *
 * The menu says plainly that this is a demonstration: the checks run in the
 * browser and are not security.
 */
export function RoleSwitcher() {
  const { role, currentMember, switchTo } = useDemoRole();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className="gap-2">
            <UserCogIcon />
            <span className="hidden sm:inline">{DEMO_ROLE_LABELS[role]}</span>
            <Badge variant="secondary" className="hidden md:inline-flex">
              Demo role
            </Badge>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>
          Viewing as {currentMember?.name ?? DEMO_ROLE_LABELS[role]}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DEMO_ROLES.map((option) => (
          <DropdownMenuItem
            key={option}
            onClick={() => switchTo(option)}
            className="flex-col items-start gap-0.5"
          >
            <span className="font-medium">
              {DEMO_ROLE_LABELS[option]}
              {option === role ? " · current" : ""}
            </span>
            <span className="text-xs text-muted-foreground">
              {DEMO_ROLE_DESCRIPTIONS[option]}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <div className="flex gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <p>
            Role switching changes what this demo shows. It is not access control — a real
            deployment must enforce permissions on a server.
          </p>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
