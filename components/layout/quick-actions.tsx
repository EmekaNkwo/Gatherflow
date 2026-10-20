"use client";

import { useAddMemberStore } from "@/stores/add-member-store";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRole } from "@/hooks/useRole";
import { useWelcomeStore } from "@/stores/welcome-store";
import type { Capability } from "@/types/team";

interface QuickAction {
  label: string;
  description: string;
  /** Where it goes; "welcome", "welcome-full" and "add-member" open a modal instead. */
  href: string;
  icon: typeof UserPlusIcon;
  capability: Capability;
}

const ACTIONS: readonly QuickAction[] = [
  {
    label: "Register a visitor",
    description: "Full registration form",
    href: "welcome-full",
    icon: UserPlusIcon,
    capability: "visitors.write",
  },
  {
    label: "Welcome someone new",
    description: "Name and phone, one person after another",
    href: "welcome",
    icon: UserPlusIcon,
    capability: "visitors.write",
  },
  {
    label: "Add a member",
    description: "Register someone as a member",
    href: "add-member",
    icon: UsersIcon,
    capability: "people.write",
  },
  {
    label: "Check people in",
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
  const { can } = useRole();
  const available = ACTIONS.filter((action) => can(action.capability));
  const showWelcome = useWelcomeStore((state) => state.show);
  const showAddMember = useAddMemberStore((state) => state.show);

  if (!available.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button size="sm" className="gap-1.5">
            <PlusIcon />
            <span>New</span>
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Add something new</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {available.map((action) => (
            <DropdownMenuItem
              key={action.href}
              {...(action.href === "add-member"
                ? { onClick: () => showAddMember() }
                : action.href === "welcome" || action.href === "welcome-full"
                  ? { onClick: () => showWelcome({ mode: action.href === "welcome-full" ? "full" : "quick" }) }
                  : { render: <Link href={action.href} /> })}
            >
              <action.icon />
              <div className="flex flex-col">
                <span>{action.label}</span>
                <span className="text-xs text-muted-foreground">{action.description}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
