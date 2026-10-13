"use client";

import Link from "next/link";
import { UsersIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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

/**
 * Suggests existing records rather than blocking registration — two people
 * really can share a name, so the volunteer decides.
 */
export function DuplicateSuggestions({ matches, onUseExisting }: DuplicateSuggestionsProps) {
  if (!matches.length) return null;

  return (
    <Alert>
      <UsersIcon />
      <AlertTitle>
        {matches.length === 1
          ? "This might already be in the directory"
          : `${matches.length} records look similar`}
      </AlertTitle>
      <AlertDescription>
        <p>
          Have a look before saving. If it is the same person, record the visit against their
          existing record instead of creating a second one.
        </p>
        <ul className="mt-2 w-full space-y-2">
          {matches.map((match) => (
            <li
              key={match.person.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <Link href={personHref(match.person)} className="font-medium hover:underline">
                    {displayName(match.person)}
                  </Link>
                  <Badge variant={match.confidence === "high" ? "default" : "secondary"}>
                    {match.confidence === "high"
                      ? "Likely the same person"
                      : match.confidence === "medium"
                        ? "Possibly the same person"
                        : "Worth a look"}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {match.reason}
                  {match.person.visitor
                    ? ` · first visit ${formatDisplayDate(match.person.visitor.firstVisitDate)}`
                    : match.person.member
                      ? ` · member ${match.person.member.reference}`
                      : ""}
                </p>
              </div>
              {onUseExisting ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onUseExisting(match.person.id)}
                >
                  Use this record
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
