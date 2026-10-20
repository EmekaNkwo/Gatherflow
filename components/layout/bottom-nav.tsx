"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheckIcon, ListChecksIcon, MenuIcon, SunIcon, UserPlusIcon, UsersIcon } from "lucide-react";
import { cn } from "cn";
import { useSidebar } from "@/components/ui/sidebar";
import { useNotifications } from "@/hooks/useNotifications";
import { useRole } from "@/hooks/useRole";
import { useWelcomeStore } from "@/stores/welcome-store";

interface Tab {
  label: string;
  /** Where the tab goes — or, with `onSelect`, a key only. */
  href: string;
  /** A tab that opens something over the page instead of navigating. */
  onSelect?: () => void;
  /** Shown as current while what it opened is open. */
  pressed?: boolean;
  icon: typeof SunIcon;
  badge?: number;
  /** Highlight for child routes too. */
  nested?: boolean;
}

/**
 * The phone's tab bar: the four things a person does most, within reach of
 * a thumb, and "Menu" for everything else. Hidden from medium screens up,
 * where the sidebar is always there.
 */
export function BottomNav() {
  const pathname = usePathname();
  const { can } = useRole();
  const { mine } = useNotifications();
  const { setOpenMobile } = useSidebar();
  const welcomeOpen = useWelcomeStore((state) => state.open);
  const showWelcome = useWelcomeStore((state) => state.show);
  const waiting = mine.dueToday.length + mine.overdue.length;

  const tabs: Tab[] = [
    { label: "Today", href: "/dashboard", icon: SunIcon },
    ...(can("tasks.read.own")
      ? [{ label: "Follow-ups", href: "/follow-ups/my-tasks", icon: ListChecksIcon, badge: waiting }]
      : []),
    ...(can("visitors.write")
      ? [{ label: "Welcome", href: "welcome", icon: UserPlusIcon, onSelect: () => showWelcome(), pressed: welcomeOpen }]
      : can("people.read")
        ? [{ label: "People", href: "/visitors", icon: UsersIcon, nested: true }]
        : []),
    ...(can("attendance.write")
      ? [{ label: "Check-in", href: "/attendance", icon: CalendarCheckIcon, nested: true }]
      : []),
  ];

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="mx-auto grid max-w-md" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          const active = tab.onSelect
            ? Boolean(tab.pressed)
            : tab.nested
              ? pathname.startsWith(tab.href)
              : pathname === tab.href;
          const className = cn(
            "relative flex min-h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground transition-colors",
            active && "text-primary",
          );
          const content = (
            <>
              <span
                className={cn(
                  "flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                  active && "bg-accent",
                )}
              >
                <tab.icon className="size-5" />
              </span>
              {tab.label}
              {tab.badge ? (
                <span className="absolute top-1.5 left-1/2 ml-2 min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] leading-5 text-primary-foreground">
                  {tab.badge}
                  <span className="sr-only"> waiting</span>
                </span>
              ) : null}
            </>
          );
          return (
            <li key={tab.href}>
              {tab.onSelect ? (
                <button type="button" aria-pressed={active} onClick={tab.onSelect} className={className}>
                  {content}
                </button>
              ) : (
                <Link href={tab.href} aria-current={active ? "page" : undefined} className={className}>
                  {content}
                </Link>
              )}
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className="flex min-h-16 w-full flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
          >
            <span className="flex h-8 w-14 items-center justify-center rounded-full">
              <MenuIcon className="size-5" />
            </span>
            Menu
          </button>
        </li>
      </ul>
    </nav>
  );
}
