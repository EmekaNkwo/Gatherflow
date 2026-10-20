"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, EllipsisIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDisplayDate } from "@/lib/dates";
import type { AttendanceSession } from "@/types/attendance";
import type { UpdateSessionInput } from "@/services/attendance/sessions";
import { DeleteSessionDialog, EditSessionDialog } from "./session-dialogs";

export interface SessionListEntry {
  session: AttendanceSession;
  /** People checked in. Shown for services that have happened. */
  total?: number;
}

interface SessionListProps {
  entries: readonly SessionListEntry[];
  today: string;
  /** Whether this person may change and delete services. */
  canManage: boolean;
  onUpdate: (input: UpdateSessionInput) => Promise<{ ok: boolean }>;
  onDelete: (sessionId: string) => Promise<{ ok: boolean }>;
}

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

/**
 * A list of services, each one tap from its check-in page. People who manage
 * services also get a menu to correct or delete one — the only way to fix a
 * mistyped date or remove a service added by mistake.
 */
export function SessionList({ entries, today, canManage, onUpdate, onDelete }: SessionListProps) {
  const [editing, setEditing] = useState<SessionListEntry | null>(null);
  const [deleting, setDeleting] = useState<SessionListEntry | null>(null);

  return (
    <>
      <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
        {entries.map((entry) => {
          const { session } = entry;
          return (
            <li key={session.id} className="flex items-center">
              <Link
                href={`/attendance/${session.id}`}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-5 py-3 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{session.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {formatDisplayDate(session.date)} at {session.startTime}
                  </span>
                </span>
                {entry.total !== undefined && session.date <= today ? (
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{people(entry.total)}</span>
                ) : null}
                {canManage ? null : <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />}
              </Link>
              {canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        size="icon-lg"
                        variant="ghost"
                        className="mr-2 shrink-0 rounded-full"
                        aria-label={`Change or delete ${session.name} on ${formatDisplayDate(session.date)}`}
                      >
                        <EllipsisIcon />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem className="min-h-11" onClick={() => setEditing(entry)}>
                      Change name, date or time…
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11" variant="destructive" onClick={() => setDeleting(entry)}>
                      Delete this service…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>

      {editing ? (
        <EditSessionDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          today={today}
          session={{ ...editing.session, notes: editing.session.notes ?? "" }}
          onConfirm={async (input) => {
            const outcome = await onUpdate({ ...input, sessionId: editing.session.id, groupId: editing.session.groupId });
            if (outcome.ok) setEditing(null);
          }}
        />
      ) : null}

      {deleting ? (
        <DeleteSessionDialog
          open
          onOpenChange={(open) => !open && setDeleting(null)}
          sessionName={deleting.session.name}
          sessionDate={deleting.session.date}
          present={deleting.total ?? 0}
          onConfirm={async () => {
            const outcome = await onDelete(deleting.session.id);
            if (outcome.ok) setDeleting(null);
          }}
        />
      ) : null}
    </>
  );
}
