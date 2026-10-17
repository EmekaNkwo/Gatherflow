"use client";

import { useMemo, useRef, useState } from "react";
import { CheckIcon, SearchIcon, UserPlusIcon, XIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { LinkButton } from "@/components/shared/link-button";
import { displayName, normalise } from "@/lib/strings";
import type { Person } from "@/types/person";

interface CheckInSearchProps {
  /** People not yet checked in to this service. */
  notPresent: readonly Person[];
  onCheckIn: (person: Person) => void;
}

const MAX_RESULTS = 20;

/**
 * Search-first check-in: type a few letters of a name, tap the person, and
 * the box clears ready for the next one. Phone numbers and member numbers
 * still match, for the rare time two people share a name.
 */
export function CheckInSearch({ notPresent, onCheckIn }: CheckInSearchProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const needle = normalise(search);

  const matches = useMemo(() => {
    if (!needle) return [];
    return notPresent
      .filter((person) =>
        normalise(
          `${person.firstName} ${person.lastName} ${person.phone ?? ""} ${person.member?.reference ?? ""}`,
        ).includes(needle),
      )
      .slice(0, MAX_RESULTS);
  }, [notPresent, needle]);

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
            {matches.map((person) => (
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
            ))}
          </ul>
        ) : (
          <div className="space-y-3 rounded-3xl bg-muted px-5 py-5">
            <p>
              Nobody called “{search.trim()}” yet. If they’re new, welcome them and they’ll be on the
              list next time.
            </p>
            <LinkButton variant="outline" size="lg" href="/visitors/quick" className="rounded-full bg-background">
              <UserPlusIcon />
              Welcome someone new
            </LinkButton>
          </div>
        )
      ) : notPresent.length === 0 ? (
        <p className="rounded-2xl bg-muted px-5 py-4 text-muted-foreground">Everyone we know is already here.</p>
      ) : null}
    </div>
  );
}
