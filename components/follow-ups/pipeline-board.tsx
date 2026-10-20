"use client";

import Link from "next/link";
import { ChevronDownIcon, EllipsisIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { describeDueDate, formatShortDate } from "@/lib/dates";
import { displayName } from "@/lib/strings";
import { FOLLOW_UP_TASK_TYPE_LABELS, type PipelineStage } from "@/types/follow-up";
import { plainStageName } from "@/services/visitors/stage-names";
import type { VisitorRow } from "@/services/visitors/selectors";

type Column = { stage: PipelineStage; rows: VisitorRow[] };

/**
 * What each card offers, decided per visitor by the caller with `canRun`, so
 * a card never shows a move the server would refuse.
 */
export interface BoardActions {
  canMove: (row: VisitorRow) => boolean;
  canStop: (row: VisitorRow) => boolean;
  canReopen: (row: VisitorRow) => boolean;
  onMove: (personId: string, stageId: string) => void;
  /** Stopping goes through its own dialog, so a reason is recorded. */
  onStop: (row: VisitorRow) => void;
  /** Back into an active stage, from a final one or a stopped follow-up. */
  onReopen: (row: VisitorRow, stageId: string) => void;
  /** The stage that means "follow-up stopped". */
  closedStageId?: string;
}

interface PipelineBoardProps {
  columns: ReadonlyArray<Column>;
  now: Date;
  actions: BoardActions;
}

// Kept here as well, for screens that already import it from the board.
export { plainStageName };

/**
 * Where each visitor is on their way in. A board of calm columns on a wide
 * screen; on a phone, the same stages stacked as a list that folds open.
 * Moving someone notes the change on their timeline; nobody has to pass
 * through every stage.
 */
export function PipelineBoard(props: PipelineBoardProps) {
  const isMobile = useIsMobile();
  return isMobile ? <StageList {...props} /> : <Board {...props} />;
}

function Board({ columns, now, actions }: PipelineBoardProps) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      <div className="flex min-w-max gap-4">
        {columns.map(({ stage, rows }) => (
          <section
            key={stage.id}
            className="flex w-72 shrink-0 flex-col gap-3 rounded-3xl bg-muted/60 p-3"
            aria-label={`${plainStageName(stage)}, ${rows.length} ${rows.length === 1 ? "person" : "people"}`}
          >
            <header className="space-y-0.5 px-2 pt-1">
              <h3 className="flex items-baseline justify-between gap-2 font-medium">
                {plainStageName(stage)}
                <span className="text-sm font-normal text-muted-foreground tabular-nums">{rows.length}</span>
              </h3>
              {stage.suggestedAction ? (
                <p className="text-sm text-muted-foreground">{stage.suggestedAction}</p>
              ) : null}
            </header>

            {rows.length ? (
              <ol className="flex flex-col gap-2">
                {rows.map((row) => (
                  <li key={row.person.id}>
                    <article className="space-y-2 rounded-2xl border bg-card p-4">
                      <div className="flex items-start gap-2">
                        <Link
                          href={`/visitors/${row.person.id}`}
                          className="min-w-0 flex-1 truncate font-medium hover:underline"
                        >
                          {displayName(row.person)}
                        </Link>
                        <MoveMenu row={row} stage={stage} columns={columns} actions={actions} />
                      </div>
                      <PersonSummary row={row} now={now} />
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-2 pb-2 text-sm text-muted-foreground">Nobody here right now.</p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function StageList({ columns, now, actions }: PipelineBoardProps) {
  return (
    <div className="space-y-3">
      {columns.map(({ stage, rows }) => (
        <details
          key={stage.id}
          open={stage.kind === "active" && rows.length > 0}
          className="group overflow-hidden rounded-3xl border bg-card"
        >
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{plainStageName(stage)}</span>
              {stage.suggestedAction ? (
                <span className="block truncate text-sm text-muted-foreground">{stage.suggestedAction}</span>
              ) : null}
            </span>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-sm text-muted-foreground tabular-nums">
              {rows.length}
            </span>
            <ChevronDownIcon className="size-5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>

          {rows.length ? (
            <ul className="divide-y border-t">
              {rows.map((row) => (
                <li key={row.person.id} className="flex min-h-16 items-center gap-2 py-3 pr-2 pl-5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <Link href={`/visitors/${row.person.id}`} className="block truncate font-medium hover:underline">
                      {displayName(row.person)}
                    </Link>
                    <PersonSummary row={row} now={now} />
                  </div>
                  <MoveMenu row={row} stage={stage} columns={columns} actions={actions} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t px-5 py-4 text-sm text-muted-foreground">Nobody here right now.</p>
          )}
        </details>
      ))}
    </div>
  );
}

/** Who is looking out for them, and what happens next, in a line or two. */
function PersonSummary({ row, now }: { row: VisitorRow; now: Date }) {
  const lastSeen = row.lastVisit ?? row.firstVisit;
  return (
    <div className="space-y-1 text-sm text-muted-foreground">
      <p className="truncate">
        {row.assigneeName ?? "Nobody assigned"} · last here {formatShortDate(lastSeen)}
      </p>
      {row.nextFollowUp ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{FOLLOW_UP_TASK_TYPE_LABELS[row.nextFollowUp.type]}</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium",
              row.hasOverdue ? "bg-primary/12 text-primary dark:text-foreground" : "bg-muted",
            )}
          >
            {describeDueDate(row.nextFollowUp.dueDate, now)}
          </span>
        </p>
      ) : row.closedReason ? (
        <p className="truncate">{row.closedReason}</p>
      ) : null}
      {row.optedOut ? <p className="font-medium text-destructive">Do not contact</p> : null}
    </div>
  );
}

function MoveMenu({
  row,
  stage,
  columns,
  actions,
}: {
  row: VisitorRow;
  stage: PipelineStage;
  columns: ReadonlyArray<Column>;
  actions: BoardActions;
}) {
  const name = displayName(row.person);
  const finished = stage.kind === "terminal" || Boolean(row.person.visitor?.closure);
  const activeStages = columns.filter((column) => column.stage.kind === "active");

  // A final stage or a stopped follow-up has one way out: reopening, into
  // whichever active stage fits. Everything else can move anywhere, except
  // that "stopped" asks why first.
  const items = finished
    ? actions.canReopen(row)
      ? activeStages.map((column) => ({
          key: column.stage.id,
          label: plainStageName(column.stage),
          run: () => actions.onReopen(row, column.stage.id),
        }))
      : []
    : columns
        .filter((column) => column.stage.id !== stage.id)
        .flatMap((column) => {
          if (column.stage.id === actions.closedStageId) {
            return actions.canStop(row)
              ? [{ key: column.stage.id, label: "Stop following up…", run: () => actions.onStop(row) }]
              : [];
          }
          return actions.canMove(row)
            ? [{ key: column.stage.id, label: plainStageName(column.stage), run: () => actions.onMove(row.person.id, column.stage.id) }]
            : [];
        });

  if (!items.length) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-lg"
            variant="ghost"
            className="-my-2 shrink-0 rounded-full"
            aria-label={finished ? `Reopen follow-up for ${name}` : `Move ${name} to another stage`}
          >
            <EllipsisIcon />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            {finished ? `Reopen and move ${row.person.firstName} to…` : `Move ${row.person.firstName} to…`}
          </DropdownMenuLabel>
          {items.map((item) => (
            <DropdownMenuItem key={item.key} className="min-h-11" onClick={item.run}>
              {item.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
