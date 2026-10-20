"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlusIcon,
  ClipboardListIcon,
  SearchIcon,
  UserPlusIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { useWelcomeStore } from "@/stores/welcome-store";
import type { Capability } from "@/types/team";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { useGlobalSearch } from "@/hooks/useGlobalSearch";

const KIND_LABELS: Record<string, string> = {
  visitor: "Visitors",
  member: "Members",
  task: "Follow-up tasks",
  group: "Groups",
  session: "Services & events",
};

/**
 * Keyboard-first search and quick actions.
 *
 * Results come from the search service, which scopes them to the active
 * signed-in role — a volunteer will not find other people's tasks here.
 */
/** Shortcuts offered before anything is typed, each only to the roles that can use it. */
const SHORTCUTS: ReadonlyArray<{
  value: string;
  label: string;
  /** Where it goes; "welcome" opens the welcome modal instead. */
  href: string;
  icon: typeof UserPlusIcon;
  allowed: (can: (capability: Capability) => boolean) => boolean;
}> = [
  { value: "welcome", label: "Welcome someone new", href: "welcome", icon: UserPlusIcon, allowed: (can) => can("visitors.write") },
  { value: "check-in", label: "Check-in", href: "/attendance", icon: CalendarPlusIcon, allowed: (can) => can("attendance.write") },
  {
    value: "waiting",
    label: "Follow-ups still waiting",
    href: "/follow-ups/tasks?due=overdue",
    icon: ClipboardListIcon,
    allowed: (can) => can("tasks.read.all"),
  },
  { value: "groups", label: "Groups", href: "/groups", icon: UsersRoundIcon, allowed: (can) => can("tasks.read.all") },
];

export function CommandPalette() {
  const { can } = useRole();
  const showWelcome = useWelcomeStore((state) => state.show);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { query, setQuery, grouped, hasQuery, searching } = useGlobalSearch();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        aria-label="Search people and follow-ups"
        className="size-10 justify-center rounded-full text-muted-foreground sm:h-9 sm:w-64 sm:justify-start sm:rounded-lg"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="sr-only flex-1 text-left sm:not-sr-only">Search people…</span>
        <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search GatherFlow"
        description="Search visitors, members, tasks, groups and services."
      >
        {/* Filtering is done by the search service, which also applies the
            signed-in role's scope, so cmdk's own filter stays off. */}
        <Command shouldFilter={false}>
          <CommandInput
          placeholder="Search people, tasks, groups…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {hasQuery && !searching && !Object.keys(grouped).length ? (
            <CommandEmpty>Nothing matched that search.</CommandEmpty>
          ) : null}

          {Object.entries(grouped).map(([kind, results]) => (
            <CommandGroup key={kind} heading={KIND_LABELS[kind] ?? kind}>
              {results.map((result) => (
                <CommandItem
                  key={`${result.kind}-${result.id}`}
                  value={`${result.kind}-${result.id}`}
                  onSelect={() => go(result.href)}
                >
                  <div className="flex flex-col">
                    <span>{result.title}</span>
                    <span className="text-xs text-muted-foreground">{result.subtitle}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {!hasQuery ? (
            <>
              <CommandGroup heading="Go to">
                {SHORTCUTS.filter((shortcut) => shortcut.allowed(can)).map((shortcut) => (
                  <CommandItem
                    key={shortcut.value}
                    value={shortcut.value}
                    onSelect={() => {
                      if (shortcut.href !== "welcome") return go(shortcut.href);
                      setOpen(false);
                      showWelcome();
                    }}
                  >
                    <shortcut.icon />
                    {shortcut.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="Tip">
                <CommandItem value="tip" disabled>
                  Type at least two characters to search people, tasks and groups.
                </CommandItem>
              </CommandGroup>
            </>
          ) : null}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
