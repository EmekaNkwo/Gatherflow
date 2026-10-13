import {
  BarChart3Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  HeartHandshakeIcon,
  HistoryIcon,
  HomeIcon,
  KanbanIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
  SettingsIcon,
  UserPlusIcon,
  UsersIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import type { Capability } from "@/types/team";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Hidden unless the active demo role has one of these capabilities. */
  capabilities?: readonly Capability[];
  /** Matches child routes too, e.g. `/visitors/person_1`. */
  matchNested?: boolean;
}

export interface NavSection {
  label: string;
  items: readonly NavItem[];
}

/**
 * Navigation. Sections mirror how a church team actually works: who is
 * here, who needs attention, what the church runs, and how it keeps in
 * touch.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/", icon: LayoutDashboardIcon }],
  },
  {
    label: "People",
    items: [
      {
        label: "Visitors",
        href: "/visitors",
        icon: UserPlusIcon,
        capabilities: ["people.read"],
        matchNested: true,
      },
      {
        label: "Members",
        href: "/members",
        icon: UsersIcon,
        capabilities: ["people.read"],
        matchNested: true,
      },
      {
        label: "Households",
        href: "/households",
        icon: HomeIcon,
        capabilities: ["people.read"],
      },
      {
        label: "Groups & ministries",
        href: "/groups",
        icon: UsersRoundIcon,
        matchNested: true,
      },
    ],
  },
  {
    label: "Follow-up",
    items: [
      {
        label: "Follow-up pipeline",
        href: "/follow-ups",
        icon: KanbanIcon,
        capabilities: ["tasks.read.all"],
      },
      {
        label: "All tasks",
        href: "/follow-ups/tasks",
        icon: ClipboardListIcon,
        capabilities: ["tasks.read.all", "tasks.read.own"],
      },
      {
        label: "My tasks",
        href: "/follow-ups/my-tasks",
        icon: CalendarCheckIcon,
        capabilities: ["tasks.read.own"],
      },
      {
        label: "Calendar",
        href: "/follow-ups/calendar",
        icon: CalendarDaysIcon,
        capabilities: ["tasks.read.own"],
      },
      {
        label: "History",
        href: "/follow-ups/history",
        icon: HistoryIcon,
        capabilities: ["tasks.read.all"],
      },
    ],
  },
  {
    label: "Church operations",
    items: [
      {
        label: "Attendance",
        href: "/attendance",
        icon: CalendarCheckIcon,
        matchNested: true,
      },
      { label: "Services & events", href: "/services", icon: CalendarDaysIcon },
      {
        label: "Pastoral care",
        href: "/pastoral-care",
        icon: HeartHandshakeIcon,
        capabilities: ["care.read"],
        matchNested: true,
      },
    ],
  },
  {
    label: "Communications",
    items: [
      {
        label: "Message templates",
        href: "/communications/templates",
        icon: MessageSquareIcon,
        capabilities: ["communications.write"],
      },
      {
        label: "Communication history",
        href: "/communications/history",
        icon: HistoryIcon,
        capabilities: ["communications.write"],
      },
    ],
  },
  {
    label: "Insights",
    items: [
      {
        label: "Reports & analytics",
        href: "/reports",
        icon: BarChart3Icon,
        capabilities: ["analytics.read"],
      },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: SettingsIcon,
        capabilities: ["settings.write"],
      },
    ],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  if (item.matchNested) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}
