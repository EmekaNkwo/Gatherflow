"use client";

import Link from "next/link";
import { ArrowRightIcon, ClockIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { OptedOutBadge, OverdueBadge } from "@/components/shared/badges";
import { describeDueDate, formatShortDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import type { PipelineStage } from "@/types/follow-up";
import type { VisitorRow } from "@/services/visitors/selectors";

interface PipelineBoardProps {
  columns: ReadonlyArray<{ stage: PipelineStage; rows: VisitorRow[] }>;
  now: Date;
  canEdit: boolean;
  onMove: (personId: string, stageId: string) => void;
}

/**
 * The follow-up pipeline as a board.
 *
 * Each card says who is responsible, when the next action is due and what it
 * is — the three things a coordinator needs before deciding anything.
 */
export function PipelineBoard({ columns, now, canEdit, onMove }: PipelineBoardProps) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {columns.map(({ stage, rows }) => (
          <section
            key={stage.id}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-xl border bg-muted/30 p-2"
            aria-label={`${stage.name}, ${rows.length} visitors`}
          >
            <header className="flex items-center justify-between gap-2 px-1">
              <div>
                <h3 className="text-sm font-medium">{stage.name}</h3>
                {stage.suggestedAction ? (
                  <p className="text-xs text-muted-foreground">{stage.suggestedAction}</p>
                ) : null}
              </div>
              <Badge variant={rows.length ? "secondary" : "outline"}>{rows.length}</Badge>
            </header>

            <ol className="flex flex-col gap-2">
              {rows.map((row) => (
                <li key={row.person.id}>
                  <article className="space-y-2 rounded-lg border bg-background p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/visitors/${row.person.id}`}
                        className="font-medium hover:underline"
                      >
                        {displayName(row.person)}
                      </Link>
                      {row.hasOverdue ? <OverdueBadge /> : null}
                    </div>

                    <dl className="space-y-0.5 text-xs text-muted-foreground">
                      <div className="flex justify-between gap-2">
                        <dt>Last visit</dt>
                        <dd>{formatShortDate(row.lastVisit ?? row.firstVisit)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Assigned</dt>
                        <dd>{row.assigneeName ?? "Nobody"}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Last contact</dt>
                        <dd>
                          {row.person.visitor?.lastContactAt
                            ? formatShortDate(row.person.visitor.lastContactAt)
                            : "Not yet"}
                        </dd>
                      </div>
                    </dl>

                    {row.nextFollowUp ? (
                      <p className="flex items-center gap-1.5 text-xs">
                        <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {row.nextFollowUp.type.replace(/_/g, " ")} ·{" "}
                          {describeDueDate(row.nextFollowUp.dueDate, now)}
                        </span>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {row.closedReason ? row.closedReason : "No next action scheduled."}
                      </p>
                    )}

                    {row.optedOut ? <OptedOutBadge /> : null}

                    {canEdit && stage.kind !== "terminal" ? (
                      <NativeSelect
                        size="sm"
                        className="w-full"
                        aria-label={`Move ${displayName(row.person)} to another stage`}
                        value={stage.id}
                        onChange={(event) => onMove(row.person.id, event.target.value)}
                      >
                        {columns.map((column) => (
                          <NativeSelectOption key={column.stage.id} value={column.stage.id}>
                            {column.stage.id === stage.id
                              ? column.stage.name
                              : `Move to ${column.stage.name}`}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : null}
                  </article>
                </li>
              ))}

              {!rows.length ? (
                <li className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  Nobody is at this stage.
                </li>
              ) : null}
            </ol>
          </section>
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ArrowRightIcon className="size-3.5" />
        Moving someone records the change on their timeline. Nobody has to pass through every
        stage.
      </p>
    </div>
  );
}
