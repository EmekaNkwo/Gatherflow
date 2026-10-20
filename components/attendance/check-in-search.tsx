"use client";

import { WelcomeButton } from "@/components/visitors/welcome-button";
import { useMemo, useRef, useState } from "react";
import { CheckIcon, SearchIcon, Undo2Icon, UserPlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { matchesPersonQuery } from "@/lib/person-search";
import { displayName } from "@/lib/strings";
import type { Person } from "@/types/person";
import type { HereEntry } from "./here-list";

interface CheckInSearchProps {
  /** The service being checked in to; somebody new is welcomed into it. */
  sessionId: string;
  /** Everyone in the directory. */
  people: readonly Person[];
  /** Who is already checked in to this service. */
  present: readonly HereEntry[];
  onCheckIn: (person: Person) => void;
  /** Takes somebody who is already here off the list again. */
  onUndo: (entry: HereEntry) => void;
}

const MAX_RESULTS = 20;

/**
 * Search-first check-in: type a few letters of a name, tap the person, and
 * the box clears ready for the next one. Phone numbers and member numbers
 * still match, for the rare time two people share a name.
 *
 * Everyone is searched, not only the people still to arrive: somebody who
 * is already here shows as "Already here" with Undo, so nobody is ever told
 * "nobody called that" and invited to create a duplicate. "Welcome someone
 * new" is offered only when nobody at all matches.
 */
export function CheckInSearch({ sessionId, people, present, onCheckIn, onUndo }: CheckInSearchProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const needle = search.trim();

  const hereByPerson = useMemo(
    () => new Map(present.map((entry) => [entry.record.personId, entry])),
    [present],
  );

  const matches = useMemo(() => {
    if (!needle) return [];
    return people
      .filter((person) => matchesPersonQuery(person, needle))
      .slice(0, MAX_RESULTS);
  }, [people, needle]);

  const everyoneHere = people.length > 0 && people.every((person) => hereByPerson.has(person.id));

  const checkIn = (person: Person) => {
    onCheckIn(person);
    setSearch("");
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-3">
      <div className="sticky top-16 z-20 -mx-4 bg-background/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Find someone by name"
            aria-label="Search people to check in"
            autoComplete="off"
            enterKeyHint="search"
            className="h-14 rounded-full bg-card pr-14 pl-13 text-lg md:text-lg"
          />
          {search ? (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                inputRef.current?.focus();
              }}
              aria-label="Clear the search"
              className="absolute top-1/2 right-1.5 flex size-11 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <XIcon className="size-5" />
            </button>
          ) : null}
        </div>
      </div>

      {needle ? (
        matches.length ? (
          <ul className="divide-y overflow-hidden rounded-3xl border bg-card" aria-label="People who match">
            {matches.map((person) => {
              const here = hereByPerson.get(person.id);
              return here ? (
                <li key={person.id} className="flex min-h-16 items-center gap-3 py-2 pr-2 pl-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-medium">{displayName(person)}</span>
                    <span className="block text-sm text-muted-foreground">Already here</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="lg"
                    className="shrink-0 rounded-full px-3 text-muted-foreground"
                    onClick={() => onUndo(here)}
                    aria-label={`Undo check-in for ${displayName(person)}`}
                  >
                    <Undo2Icon />
                    Undo
                  </Button>
                </li>
              ) : (
              <li key={person.id}>
                <button
                  type="button"
                  onClick={() => checkIn(person)}
                  aria-label={`Check in ${displayName(person)}`}
                  className="flex min-h-16 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-muted/50 active:bg-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-lg font-medium">{displayName(person)}</span>
                    <span className="block text-sm text-muted-foreground">
                      {person.member ? "Member" : "Visitor"}
                    </span>
                  </span>
                  <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-done px-4 font-medium text-done-foreground">
                    <CheckIcon className="size-4" />
                    Here
                  </span>
                </button>
              </li>
              );
            })}
          </ul>
        ) : (
          <div className="space-y-3 rounded-3xl bg-muted px-5 py-5">
            <p>
              Nobody called “{search.trim()}” yet. If they’re new, welcome them and they’ll be on the
              list next time.
            </p>
            <WelcomeButton variant="outline" size="lg" sessionId={sessionId} className="rounded-full bg-background">
              <UserPlusIcon />
              Welcome someone new
            </WelcomeButton>
          </div>
        )
      ) : everyoneHere ? (
        <p className="rounded-2xl bg-muted px-5 py-4 text-muted-foreground">Everyone we know is already here.</p>
      ) : null}
    </div>
  );
}
