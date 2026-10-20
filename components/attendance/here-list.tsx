"use client";

import Link from "next/link";
import { EllipsisIcon, Undo2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { personHref } from "@/components/shared/person-cell";
import { displayName } from "@/lib/strings";
import type { AttendanceRecord } from "@/types/attendance";
import type { Person } from "@/types/person";

export interface HereEntry {
  record: AttendanceRecord;
  person: Person | undefined;
}

interface HereListProps {
  entries: readonly HereEntry[];
  canEdit: boolean;
  /** One tap: take somebody off the list again (the change is noted, and can be undone). */
  onUndo?: (entry: HereEntry) => void;
  /** The rarer fix: move the check-in to another service, or give a reason. */
  onFix?: (entry: HereEntry) => void;
}

/** Who has been checked in, newest first so a mistaken tap is right at the top. */
export function HereList({ entries, canEdit, onUndo, onFix }: HereListProps) {
  if (!entries.length) {
    return (
      <p className="rounded-2xl bg-muted px-5 py-6 text-muted-foreground">
        {canEdit ? "Nobody yet. Find the first person above." : "Nobody has been checked in yet."}
      </p>
    );
  }

  const newestFirst = [...entries].sort((left, right) =>
    right.record.recordedAt.localeCompare(left.record.recordedAt),
  );

  return (
    <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
      {newestFirst.map((entry) => {
        const name = entry.person ? displayName(entry.person) : "Somebody no longer on record";
        return (
          <li key={entry.record.id} className="flex min-h-14 items-center gap-2 py-2 pr-2 pl-5">
            <span className="min-w-0 flex-1">
              {entry.person ? (
                <Link href={personHref(entry.person)} className="block truncate font-medium hover:underline">
                  {name}
                </Link>
              ) : (
                <span className="block truncate text-muted-foreground">{name}</span>
              )}
            </span>
            {entry.record.firstVisit ? (
              <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-0.5 text-xs font-medium text-primary dark:text-foreground">
                First visit
              </span>
            ) : null}
            {canEdit && onUndo ? (
              <Button
                variant="ghost"
                size="lg"
                className="shrink-0 rounded-full px-3 text-muted-foreground"
                onClick={() => onUndo(entry)}
                aria-label={`Undo check-in for ${name}`}
              >
                <Undo2Icon />
                Undo
              </Button>
            ) : null}
            {canEdit && onFix ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button size="icon-lg" variant="ghost" className="shrink-0 rounded-full" aria-label={`More for ${name}`}>
                      <EllipsisIcon />
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="min-h-11" onClick={() => onFix(entry)}>
                    Move to another service…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
