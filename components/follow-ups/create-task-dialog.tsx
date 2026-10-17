"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { addDaysIso } from "@/lib/dates";
import { displayName, normalise } from "@/lib/strings";
import {
  FOLLOW_UP_TASK_TYPES,
  FOLLOW_UP_TASK_TYPE_LABELS,
  TASK_PRIORITIES,
  TASK_PRIORITY_LABELS,
  type FollowUpTaskType,
  type TaskPriority,
} from "@/types/follow-up";
import type { Person } from "@/types/person";
import type { TeamMember } from "@/types/team";

export interface NewTaskValues {
  personId: string;
  type: FollowUpTaskType;
  assigneeId?: string;
  dueDate: string;
  priority: TaskPriority;
  notes?: string;
}

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: readonly Person[];
  team: readonly TeamMember[];
  today: string;
  defaultDueInDays: number;
  /** Pre-selects a person, e.g. when opened from their profile. */
  personId?: string;
  onConfirm: (values: NewTaskValues) => void;
}

/** Plans a follow-up for somebody in the directory. */
export function CreateTaskDialog(props: CreateTaskDialogProps) {
  return (
    <ResponsiveDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Plan a follow-up"
      description="Who to reach, what to do and when. Nobody who asked not to be contacted can be chased by accident."
      className="sm:max-w-lg"
    >
      {props.open ? <CreateTaskFields {...props} /> : null}
    </ResponsiveDialog>
  );
}

function CreateTaskFields({
  people,
  team,
  today,
  defaultDueInDays,
  personId,
  onOpenChange,
  onConfirm,
}: CreateTaskDialogProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(personId ?? "");
  const [type, setType] = useState<FollowUpTaskType>("check_in");
  const [assignee, setAssignee] = useState(team[0]?.id ?? "");
  const [dueDate, setDueDate] = useState(() => addDaysIso(today, defaultDueInDays));
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [notes, setNotes] = useState("");
  const [more, setMore] = useState(false);

  const matches = useMemo(() => {
    const needle = normalise(search);
    const pool = needle
      ? people.filter((person) =>
          normalise(`${person.firstName} ${person.lastName} ${person.phone ?? ""}`).includes(needle),
        )
      : people;
    return pool.slice(0, 50);
  }, [people, search]);

  const person = people.find((entry) => entry.id === selected);

  return (
    <>
      <DialogBody>
        {!personId ? (
          <Field>
            <FieldLabel htmlFor="task-person-search">Who is it for?</FieldLabel>
            <Input
              id="task-person-search"
              className="h-11"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name or phone"
            />
            <NativeSelect
              className="mt-2 w-full"
              aria-label="Select a person"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <NativeSelectOption value="">Choose someone…</NativeSelectOption>
              {matches.map((entry) => (
                <NativeSelectOption key={entry.id} value={entry.id}>
                  {displayName(entry)}
                  {entry.member ? " · member" : " · visitor"}
                  {entry.contact.optedOut ? " · do not contact" : ""}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {person?.contact.optedOut ? (
              <FieldDescription className="text-destructive">
                {displayName(person)} asked not to be contacted. Only pastoral care can be planned for them.
              </FieldDescription>
            ) : null}
          </Field>
        ) : null}

        <Field>
          <FieldLabel htmlFor="task-type">What to do</FieldLabel>
          <NativeSelect
            className="w-full"
            id="task-type"
            value={type}
            onChange={(event) => setType(event.target.value as FollowUpTaskType)}
          >
            {FOLLOW_UP_TASK_TYPES.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {FOLLOW_UP_TASK_TYPE_LABELS[option]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="task-assignee">Who</FieldLabel>
            <NativeSelect
              className="w-full"
              id="task-assignee"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <NativeSelectOption value="">Decide later</NativeSelectOption>
              {team.map((member) => (
                <NativeSelectOption key={member.id} value={member.id}>
                  {member.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          <Field>
            <FieldLabel htmlFor="task-due">When</FieldLabel>
            <Input
              id="task-due"
              type="date"
              className="h-11"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>
        </div>

        <div>
          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore((open) => !open)}
            className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            More details
            <ChevronDownIcon className={cn("size-4 transition-transform", more && "rotate-180")} />
          </button>
          {more ? (
            <div className="mt-2 space-y-4">
              <Field>
                <FieldLabel htmlFor="task-priority">How urgent</FieldLabel>
                <NativeSelect
                  className="w-full"
                  id="task-priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value as TaskPriority)}
                >
                  {TASK_PRIORITIES.map((option) => (
                    <NativeSelectOption key={option} value={option}>
                      {TASK_PRIORITY_LABELS[option]}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="task-notes">Notes</FieldLabel>
                <Textarea
                  id="task-notes"
                  rows={3}
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Anything the person doing this should know."
                />
              </Field>
            </div>
          ) : null}
        </div>
      </DialogBody>
      <DialogActions>
        <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          size="lg"
          className="flex-1"
          disabled={!selected || !dueDate}
          onClick={() =>
            onConfirm({
              personId: selected,
              type,
              assigneeId: assignee || undefined,
              dueDate,
              priority,
              notes: notes.trim() || undefined,
            })
          }
        >
          Add follow-up
        </Button>
      </DialogActions>
    </>
  );
}
