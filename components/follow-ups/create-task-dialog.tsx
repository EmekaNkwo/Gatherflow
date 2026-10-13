"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
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

/** Creates a follow-up task for somebody in the directory. */
export function CreateTaskDialog(props: CreateTaskDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create a follow-up task</DialogTitle>
          <DialogDescription>
            Tasks for someone who has asked not to be contacted are refused, so nobody is chased
            by accident.
          </DialogDescription>
        </DialogHeader>
        {props.open ? <CreateTaskFields {...props} /> : null}
      </DialogContent>
    </Dialog>
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

  const matches = useMemo(() => {
    const needle = normalise(search);
    const pool = needle
      ? people.filter((person) =>
          normalise(`${person.firstName} ${person.lastName} ${person.phone ?? ""}`).includes(
            needle,
          ),
        )
      : people;
    return pool.slice(0, 50);
  }, [people, search]);

  const person = people.find((entry) => entry.id === selected);

  return (
    <>
      {!personId ? (
        <Field>
          <FieldLabel htmlFor="task-person-search">Who is this for?</FieldLabel>
          <Input
            id="task-person-search"
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
                {entry.member ? ` · ${entry.member.reference}` : " · visitor"}
                {entry.contact.optedOut ? " · opted out" : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {person?.contact.optedOut ? (
            <FieldDescription className="text-destructive">
              {displayName(person)} has opted out of contact. Only a pastoral-care task can be
              created for them.
            </FieldDescription>
          ) : null}
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="task-type">Task type</FieldLabel>
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

        <Field>
          <FieldLabel htmlFor="task-assignee">Assign to</FieldLabel>
          <NativeSelect
            className="w-full"
            id="task-assignee"
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
          >
            <NativeSelectOption value="">Leave unassigned</NativeSelectOption>
            {team.map((member) => (
              <NativeSelectOption key={member.id} value={member.id}>
                {member.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>

        <Field>
          <FieldLabel htmlFor="task-due">Due date</FieldLabel>
          <Input
            id="task-due"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
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
      </div>

      <Field>
        <FieldLabel htmlFor="task-notes">Notes</FieldLabel>
        <Textarea
          id="task-notes"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="What needs doing, and anything the volunteer should know."
        />
      </Field>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
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
          Create task
        </Button>
      </DialogFooter>
    </>
  );
}
