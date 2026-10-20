"use client";

import { useState } from "react";
import { ChevronDownIcon, QrCodeIcon, RotateCcwIcon, UploadIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/shared/link-button";
import { Textarea } from "@/components/ui/textarea";
import { displayName } from "@/lib/strings";
import type { HereEntry } from "./here-list";

interface ServiceExtrasProps {
  canEdit: boolean;
  /** The church whose welcome page the QR check-in opens. */
  churchId?: string | null;
  initialNotes: string;
  removed: readonly HereEntry[];
  onImport: () => void;
  onRestore: (entry: HereEntry) => void;
  onSaveNotes: (notes: string) => void;
}

/**
 * The rarer jobs for a service, folded away so the door volunteer sees only
 * the search and the list: importing a list, the QR demo, check-ins that
 * were taken off, and practical notes.
 */
export function ServiceExtras({
  canEdit,
  churchId,
  initialNotes,
  removed,
  onImport,
  onRestore,
  onSaveNotes,
}: ServiceExtrasProps) {
  const [notes, setNotes] = useState(initialNotes);

  if (!canEdit && !removed.length) return null;

  return (
    <details className="group rounded-3xl border bg-card">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-medium [&::-webkit-details-marker]:hidden">
        More for this service
        <ChevronDownIcon className="size-5 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="space-y-6 border-t px-5 py-5">
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" className="rounded-full" onClick={onImport}>
              <UploadIcon />
              Import a list
            </Button>
            {churchId ? (
              <LinkButton
                variant="outline"
                size="lg"
                href={`/connect/${churchId}`}
                target="_blank"
                className="rounded-full"
              >
                <QrCodeIcon />
                QR check-in (demo)
              </LinkButton>
            ) : null}
          </div>
        ) : null}

        {removed.length ? (
          <section className="space-y-2">
            <h3 className="font-medium">Taken off the list</h3>
            <ul className="divide-y overflow-hidden rounded-2xl bg-muted">
              {removed.map((entry) => (
                <li key={entry.record.id} className="flex min-h-14 items-center gap-3 py-2 pr-2 pl-4">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {entry.person ? displayName(entry.person) : "Somebody no longer on record"}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {entry.record.corrections.at(-1)?.reason ?? "No reason given"}
                    </span>
                  </span>
                  {canEdit ? (
                    <Button variant="ghost" size="lg" className="shrink-0 rounded-full" onClick={() => onRestore(entry)}>
                      <RotateCcwIcon />
                      Restore
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {canEdit ? (
          <section className="space-y-2">
            <label htmlFor="session-notes-body" className="block font-medium">
              Notes about this service
            </label>
            <p className="text-sm text-muted-foreground">Practical things only. Keep personal detail off this page.</p>
            <Textarea
              id="session-notes-body"
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
            <Button variant="outline" size="lg" className="rounded-full" onClick={() => onSaveNotes(notes)}>
              Save notes
            </Button>
          </section>
        ) : null}
      </div>
    </details>
  );
}
