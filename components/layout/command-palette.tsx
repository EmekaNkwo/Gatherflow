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
 * demo role — a volunteer will not find other people's tasks here.
 */
export function CommandPalette() {
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
        className="w-full justify-start gap-2 text-muted-foreground sm:w-64"
        onClick={() => setOpen(true)}
      >
        <SearchIcon />
        <span className="flex-1 text-left">Search people, tasks…</span>
        <Kbd className="hidden sm:inline-flex">Ctrl K</Kbd>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search GatherFlow"
        description="Search visitors, members, tasks, groups and services."
      >
        {/* Filtering is done by the search service, which also applies the
            demo role's scope, so cmdk's own filter stays off. */}
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
              <CommandGroup heading="Quick actions">
                <CommandItem value="register-visitor" onSelect={() => go("/visitors/new")}>
                  <UserPlusIcon />
                  Register a visitor
                </CommandItem>
                <CommandItem value="quick-register" onSelect={() => go("/visitors/quick")}>
                  <UserPlusIcon />
                  Quick registration (several visitors)
                </CommandItem>
                <CommandItem value="record-attendance" onSelect={() => go("/attendance")}>
                  <CalendarPlusIcon />
                  Record attendance
                </CommandItem>
                <CommandItem value="overdue" onSelect={() => go("/follow-ups/tasks?due=overdue")}>
                  <ClipboardListIcon />
                  Review overdue follow-ups
                </CommandItem>
                <CommandItem value="groups" onSelect={() => go("/groups")}>
                  <UsersRoundIcon />
                  Groups & ministries
                </CommandItem>
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
