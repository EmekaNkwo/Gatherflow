import {
  BarChart3Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClipboardListIcon,
  HeartHandshakeIcon,
  HistoryIcon,
  HomeIcon,
  ListChecksIcon,
  MessageSquareIcon,
  RouteIcon,
  SettingsIcon,
  SunIcon,
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
  /** Hidden unless the signed-in role has one of these capabilities. */
  capabilities?: readonly Capability[];
  /**
   * Shown only to people who run the church's work (anyone who can see every
   * follow-up, configure the church, or read pastoral care). Volunteers can
   * still open these pages; the menu just stays small for them.
   */
  staff?: boolean;
  /** Matches child routes too, e.g. `/visitors/person_1`. */
  matchNested?: boolean;
}

export interface NavSection {
  /** Omitted for the first section, which needs no heading. */
  label?: string;
  items: readonly NavItem[];
}

/** Capabilities that mark somebody as running the work rather than doing it. */
export const STAFF_CAPABILITIES: readonly Capability[] = ["tasks.read.all", "settings.write", "care.read"];

/**
 * Navigation, in plain words and in the order a person reaches for it: what
 * is waiting for me, the people, Sunday, care, messages, and the church.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    items: [
      { label: "Today", href: "/dashboard", icon: SunIcon },
      {
        label: "My follow-ups",
        href: "/follow-ups/my-tasks",
        icon: ListChecksIcon,
        capabilities: ["tasks.read.own"],
      },
      {
        label: "Calendar",
        href: "/follow-ups/calendar",
        icon: CalendarDaysIcon,
        capabilities: ["tasks.read.own"],
      },
    ],
  },
  {
    label: "Follow-up",
    items: [
      {
        label: "Everyone's follow-ups",
        href: "/follow-ups/tasks",
        icon: ClipboardListIcon,
        capabilities: ["tasks.read.all"],
      },
      {
        label: "Visitor journey",
        href: "/follow-ups",
        icon: RouteIcon,
        capabilities: ["tasks.read.all"],
      },
      {
        label: "Finished follow-ups",
        href: "/follow-ups/history",
        icon: HistoryIcon,
        capabilities: ["tasks.read.all"],
      },
    ],
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
        staff: true,
        matchNested: true,
      },
      { label: "Households", href: "/households", icon: HomeIcon, capabilities: ["people.read"], staff: true },
      { label: "Groups", href: "/groups", icon: UsersRoundIcon, staff: true, matchNested: true },
    ],
  },
  {
    label: "Sundays",
    items: [
      { label: "Check-in", href: "/attendance", icon: CalendarCheckIcon, matchNested: true },
      { label: "Services & events", href: "/services", icon: CalendarDaysIcon, staff: true },
    ],
  },
  {
    label: "Care",
    items: [
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
    label: "Messages",
    items: [
      {
        label: "Templates",
        href: "/communications/templates",
        icon: MessageSquareIcon,
        capabilities: ["communications.write"],
        staff: true,
      },
      {
        label: "Sent messages",
        href: "/communications/history",
        icon: HistoryIcon,
        capabilities: ["communications.write"],
        staff: true,
      },
    ],
  },
  {
    label: "Church",
    items: [
      { label: "Reports", href: "/reports", icon: BarChart3Icon, capabilities: ["analytics.read"] },
      { label: "Settings", href: "/settings", icon: SettingsIcon, capabilities: ["settings.write"] },
    ],
  },
];

/** Whether the signed-in person should see an item in the menu. */
export function isVisible(item: NavItem, can: (capability: Capability) => boolean): boolean {
  if (item.capabilities && !item.capabilities.some(can)) return false;
  if (item.staff && !STAFF_CAPABILITIES.some(can)) return false;
  return true;
}

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.href === "/") return pathname === "/";
  if (item.matchNested) return pathname === item.href || pathname.startsWith(`${item.href}/`);
  return pathname === item.href;
}
