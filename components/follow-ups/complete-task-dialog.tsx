"use client";

import { useState, type ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/hooks/use-mobile";
import { displayName } from "@/lib/strings";
import { FOLLOW_UP_TASK_TYPE_LABELS, type TaskOutcome } from "@/types/follow-up";
import type { TaskWithPerson } from "@/services/follow-ups/selectors";
import { OUTCOMES_NEEDING_A_NOTE } from "@/services/follow-ups/completion";

/**
 * Recording what happened.
 *
 * Nearly every follow-up ends one of three ways, so those are three large
 * choices; the rarer outcomes sit behind "Something else". What the choice
 * will do next is said once, under the choice, before anything is saved. On
 * a phone this is a sheet from the bottom, with Save always in reach.
 */
interface OutcomeChoice {
  outcome: TaskOutcome;
  label: string;
  /** What happens next, in a sentence. `{name}` is the person's first name. */
  next: string;
}

const COMMON: readonly OutcomeChoice[] = [
  { outcome: "contacted", label: "We spoke", next: "We'll note that you reached {name} and suggest what comes next." },
  { outcome: "no_answer", label: "No answer", next: "We'll note the try and set up another one, unless it's been tried enough." },
  {
    outcome: "requested_another_time",
    label: "They asked me to call back",
    next: "We'll set up a call back for another time.",
  },
];

const RARER: readonly OutcomeChoice[] = [
  { outcome: "not_interested", label: "They'd rather not hear from us", next: "Follow-up for {name} stops, and their other open tasks are cancelled." },
  { outcome: "wrong_details", label: "The number or email is wrong", next: "We'll note the try and ask for their details to be checked." },
  { outcome: "needs_another_team", label: "Somebody else should help", next: "This follow-up closes as passed to another team." },
  {
    outcome: "other",
    label: "Something else happened",
    next: "This follow-up closes with your note. It doesn't count as a try to reach {name}, and nothing else is set up, so decide the next step.",
  },
];

interface CompleteTaskDialogProps {
  task: TaskWithPerson | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (outcome: TaskOutcome, note?: string) => void | Promise<unknown>;
}

export function CompleteTaskDialog({ task, onOpenChange, onConfirm }: CompleteTaskDialogProps) {
  const isMobile = useIsMobile();
  const name = task?.person ? displayName(task.person) : null;
  const title = name ? `How did it go with ${name.split(" ")[0]}?` : "How did it go?";
  const description = task ? FOLLOW_UP_TASK_TYPE_LABELS[task.task.type] : "";

  // Keyed on the task, so each one starts from a clean form.
  const form = task ? (
    <OutcomeForm
      key={task.task.id}
      firstName={name?.split(" ")[0] ?? "them"}
      onCancel={() => onOpenChange(false)}
      onConfirm={onConfirm}
    />
  ) : null;

  if (isMobile) {
    return (
      <Sheet open={Boolean(task)} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92dvh] gap-0 rounded-t-3xl px-0 pb-0">
          <SheetHeader className="px-5 pt-5 pb-2 text-left">
            <SheetTitle className="font-heading text-2xl font-medium">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          {form}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={Boolean(task)} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="font-heading text-2xl font-medium">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {form}
      </DialogContent>
    </Dialog>
  );
}

function OutcomeForm({
  firstName,
  onCancel,
  onConfirm,
}: {
  firstName: string;
  onCancel: () => void;
  onConfirm: (outcome: TaskOutcome, note?: string) => void | Promise<unknown>;
}) {
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<TaskOutcome>("contacted");
  const [showRarer, setShowRarer] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");

  const chosen = [...COMMON, ...RARER].find((choice) => choice.outcome === outcome) ?? COMMON[0];
  // "Something else" means nothing without saying what.
  const noteNeeded = OUTCOMES_NEEDING_A_NOTE.includes(outcome);
  const noteMissing = noteNeeded && !note.trim();

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={async (event) => {
        event.preventDefault();
        if (saving || noteMissing) return;
        // One tap, one save: the button stays disabled until the command returns.
        setSaving(true);
        try {
          await onConfirm(outcome, note.trim() || undefined);
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3 sm:px-6">
        <fieldset className="space-y-2">
          <legend className="sr-only">What happened</legend>
          {COMMON.map((choice) => (
            <Choice key={choice.outcome} choice={choice} selected={outcome === choice.outcome} onSelect={setOutcome} />
          ))}
          <button
            type="button"
            aria-expanded={showRarer}
            onClick={() => setShowRarer((open) => !open)}
            className="flex min-h-11 items-center gap-1.5 px-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Something else
            <ChevronDownIcon className={cn("size-4 transition-transform", showRarer && "rotate-180")} />
          </button>
          {showRarer
            ? RARER.map((choice) => (
                <Choice key={choice.outcome} choice={choice} selected={outcome === choice.outcome} onSelect={setOutcome} />
              ))
            : null}
        </fieldset>

        <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-sm text-muted-foreground">
          {chosen.next.replace("{name}", firstName)}
        </p>

        {showNote || noteNeeded ? (
          <div className="space-y-1.5">
            <label htmlFor="outcome-note" className="text-sm font-medium">
              {noteNeeded ? "What happened" : "Note for the next person"}
            </label>
            <Textarea
              id="outcome-note"
              autoFocus
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={500}
              required={noteNeeded}
              aria-invalid={noteMissing || undefined}
            />
            <p className="text-xs text-muted-foreground">
              Shown on their timeline. Keep private pastoral detail in Pastoral care.
            </p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowNote(true)}
            className="min-h-11 px-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Add a note
          </button>
        )}
      </div>

      <div className="flex gap-2 border-t bg-popover px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
        <Button type="button" variant="ghost" size="lg" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="flex-1" disabled={saving || noteMissing}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function Choice({
  choice,
  selected,
  onSelect,
}: {
  choice: OutcomeChoice;
  selected: boolean;
  onSelect: (outcome: TaskOutcome) => void;
}): ReactNode {
  return (
    <label
      className={cn(
        "flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 px-4 text-base font-medium transition-colors",
        selected ? "border-primary bg-accent" : "border-border hover:bg-muted",
      )}
    >
      <input
        type="radio"
        name="outcome"
        value={choice.outcome}
        checked={selected}
        onChange={() => onSelect(choice.outcome)}
        className="size-5 accent-[var(--primary)]"
      />
      {choice.label}
    </label>
  );
}
