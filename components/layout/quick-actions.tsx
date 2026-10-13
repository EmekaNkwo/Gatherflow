"use client";

import Link from "next/link";
import {
  CalendarPlusIcon,
  ClipboardPlusIcon,
  HeartHandshakeIcon,
  PlusIcon,
  UserPlusIcon,
  UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDemoRole } from "@/hooks/useDemoRole";
import type { Capability } from "@/types/team";

interface QuickAction {
  label: string;
  description: string;
  href: string;
  icon: typeof UserPlusIcon;
  capability: Capability;
}

const ACTIONS: readonly QuickAction[] = [
  {
    label: "Register a visitor",
    description: "Full registration form",
    href: "/visitors/new",
    icon: UserPlusIcon,
    capability: "visitors.write",
  },
  {
    label: "Quick registration",
    description: "Several visitors, one after another",
    href: "/visitors/quick",
    icon: UserPlusIcon,
    capability: "visitors.write",
  },
  {
    label: "Add a member",
    description: "Register someone as a member",
    href: "/members/new",
    icon: UsersIcon,
    capability: "people.write",
  },
  {
    label: "Record attendance",
    description: "Check people in to a service",
    href: "/attendance",
    icon: CalendarPlusIcon,
    capability: "attendance.write",
  },
  {
    label: "Create a follow-up task",
    description: "Assign work to a volunteer",
    href: "/follow-ups/tasks?new=1",
    icon: ClipboardPlusIcon,
    capability: "tasks.write",
  },
  {
    label: "Create a pastoral-care task",
    description: "Restricted to authorised roles",
    href: "/pastoral-care?new=1",
    icon: HeartHandshakeIcon,
    capability: "care.write",
  },
];

/** The one-click actions a volunteer needs on a busy service day. */
export function QuickActions() {
  const { can } = useDemoRole();
  const available = ACTIONS.filter((action) => can(action.capability));

  if (!available.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <PlusIcon />
            <span className="hidden sm:inline">Quick action</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Quick actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {available.map((action) => (
          <DropdownMenuItem key={action.href} render={<Link href={action.href} />}>
            <action.icon />
            <div className="flex flex-col">
              <span>{action.label}</span>
              <span className="text-xs text-muted-foreground">{action.description}</span>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
