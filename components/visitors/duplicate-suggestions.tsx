"use client";

import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatDisplayDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import type { DuplicateMatch } from "@/services/visitors/duplicates";
import { personHref } from "@/components/shared/person-cell";

interface DuplicateSuggestionsProps {
  matches: readonly DuplicateMatch[];
  /** Offered when the suggestion is in fact the same person. */
  onUseExisting?: (personId: string) => void;
}

const CONFIDENCE: Record<DuplicateMatch["confidence"], string> = {
  high: "Probably them",
  medium: "Might be them",
  low: "Worth a look",
};

/**
 * Suggests people already on record rather than blocking — two people
 * really can share a name, so the volunteer decides.
 */
export function DuplicateSuggestions({ matches, onUseExisting }: DuplicateSuggestionsProps) {
  if (!matches.length) return null;

  return (
    <section aria-label="People who might already be here" className="space-y-3 rounded-3xl bg-accent p-5">
      <div className="flex items-start gap-3">
        <UsersIcon className="mt-0.5 size-5 shrink-0 text-primary" />
        <div>
          <p className="font-medium">
            {matches.length === 1 ? "Have we met them before?" : "Have we met them before? A few people look similar."}
          </p>
          <p className="text-sm text-muted-foreground">
            If it&apos;s the same person, use their record so their story stays in one place.
          </p>
        </div>
      </div>
      <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
        {matches.map((match) => (
          <li key={match.person.id} className="flex min-h-14 flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={personHref(match.person)} className="font-medium hover:underline">
                  {displayName(match.person)}
                </Link>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-medium",
                    match.confidence === "high"
                      ? "bg-primary/12 text-primary dark:text-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {CONFIDENCE[match.confidence]}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {match.reason}
                {match.person.visitor
                  ? ` · first came ${formatDisplayDate(match.person.visitor.firstVisitDate)}`
                  : match.person.member
                    ? " · a member"
                    : ""}
              </p>
            </div>
            {onUseExisting ? (
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="rounded-full"
                onClick={() => onUseExisting(match.person.id)}
              >
                That&apos;s them
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
