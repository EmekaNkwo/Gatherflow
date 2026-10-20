"use client";

import { useMemo, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { SelectField } from "@/components/shared/select-field";
import { addDaysIso } from "@/lib/dates";
import { matchesPersonQuery } from "@/lib/person-search";
import { displayName } from "@/lib/strings";
import { allowedTaskTypes, canBeContacted } from "@/services/follow-ups/contact";
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

const TASK_PRIORITY_OPTIONS = TASK_PRIORITIES.map((option) => ({ value: option, label: TASK_PRIORITY_LABELS[option] }));

/** The server's limit on task notes. */
const NOTES_LIMIT = 500;

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
  /** The signed-in team member, offered as "Me". */
  currentMemberId?: string;
  /**
   * A role scoped to its own work (a volunteer) may only plan follow-ups for
   * themselves: the server refuses anyone else, so nobody else is offered.
   */
  ownOnly?: boolean;
  /** Resolves when the command returns; the button stays busy until then. */
  onConfirm: (values: NewTaskValues) => void | Promise<unknown>;
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

/** The kinds of follow-up this person can have, given their consent. */
function typesFor(person: Person | undefined): FollowUpTaskType[] {
  if (!person) return [...FOLLOW_UP_TASK_TYPES];
  if (person.contact.optedOut) return ["pastoral_contact"];
  return allowedTaskTypes(person, FOLLOW_UP_TASK_TYPES);
}

/** Who a new follow-up goes to unless changed: yourself, or whoever looks after them. */
function defaultAssignee(
  person: Person | undefined,
  team: readonly TeamMember[],
  ownOnly: boolean,
  currentMemberId: string | undefined,
): string {
  if (ownOnly) return currentMemberId ?? "";
  const keeper = person?.visitor?.assignedTo;
  return keeper && team.some((member) => member.id === keeper) ? keeper : "";
}

function CreateTaskFields({
  people,
  team,
  today,
  defaultDueInDays,
  personId,
  currentMemberId,
  ownOnly = false,
  onOpenChange,
  onConfirm,
}: CreateTaskDialogProps) {
  const initialPerson = people.find((entry) => entry.id === personId);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(personId ?? "");
  const [type, setType] = useState<FollowUpTaskType>(() =>
    initialPerson && !canBeContacted(initialPerson) ? typesFor(initialPerson)[0] : "check_in",
  );
  const [assignee, setAssignee] = useState(() => defaultAssignee(initialPerson, team, ownOnly, currentMemberId));
  const [assigneeTouched, setAssigneeTouched] = useState(false);
  const [dueDate, setDueDate] = useState(() => addDaysIso(today, defaultDueInDays));
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [notes, setNotes] = useState("");
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);

  const matches = useMemo(
    () => (search.trim() ? people.filter((person) => matchesPersonQuery(person, search)) : people).slice(0, 50),
    [people, search],
  );

  const personOptions = useMemo(
    () => [
      { value: "", label: "Choose someone…" },
      ...matches.map((entry) => ({
        value: entry.id,
        label: `${displayName(entry)}${entry.member ? " · member" : " · visitor"}${entry.contact.optedOut ? " · do not contact" : ""}`,
      })),
    ],
    [matches],
  );

  const person = people.find((entry) => entry.id === selected);
  const allowedTypes = typesFor(person);
  const chosenType = allowedTypes.includes(type) ? type : allowedTypes[0];
  const pastDue = Boolean(dueDate) && dueDate < today;

  const assigneeOptions = ownOnly
    ? team
        .filter((member) => member.id === currentMemberId)
        .map((member) => ({ value: member.id, label: `Me (${member.name})` }))
    : [
        { value: "", label: "Decide later" },
        ...team.map((member) => ({
          value: member.id,
          label: member.id === currentMemberId ? `Me (${member.name})` : member.name,
        })),
      ];

  const choosePerson = (id: string) => {
    setSelected(id);
    // Follow whoever looks after the new person, unless a choice was made.
    if (!assigneeTouched) {
      setAssignee(defaultAssignee(people.find((entry) => entry.id === id), team, ownOnly, currentMemberId));
    }
  };

  const submit = async () => {
    if (saving || !selected || !dueDate || pastDue) return;
    setSaving(true);
    try {
      await onConfirm({
        personId: selected,
        type: chosenType,
        assigneeId: assignee || undefined,
        dueDate,
        priority,
        notes: notes.trim() || undefined,
      });
    } finally {
      setSaving(false);
    }
  };

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
            <SelectField
              className="mt-2"
              aria-label="Select a person"
              value={selected}
              onValueChange={choosePerson}
              options={personOptions}
            />
          </Field>
        ) : null}
        {person?.contact.optedOut ? (
          <p className="text-sm text-destructive">
            {displayName(person)} asked not to be contacted. Only pastoral care can be planned for them.
          </p>
        ) : person && !canBeContacted(person) ? (
          <p className="text-sm text-muted-foreground">
            {displayName(person)} hasn&apos;t agreed to be contacted, so nobody can message them. You can plan a hello in
            person instead.
          </p>
        ) : null}

        <SelectField
          id="task-type"
          label="What to do"
          value={chosenType}
          onValueChange={(value) => setType(value as FollowUpTaskType)}
          options={allowedTypes.map((option) => ({ value: option, label: FOLLOW_UP_TASK_TYPE_LABELS[option] }))}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="task-assignee"
            label="Who"
            value={assignee}
            onValueChange={(value) => {
              setAssignee(value);
              setAssigneeTouched(true);
            }}
            disabled={ownOnly}
            options={assigneeOptions}
          />

          <Field>
            <FieldLabel htmlFor="task-due">When</FieldLabel>
            <Input
              id="task-due"
              type="date"
              className="h-11"
              min={today}
              value={dueDate}
              aria-invalid={pastDue || undefined}
              onChange={(event) => setDueDate(event.target.value)}
            />
            {pastDue ? <FieldError>Choose today or a later day.</FieldError> : null}
          </Field>
        </div>
        {ownOnly ? <FieldDescription>Follow-ups you plan come to you.</FieldDescription> : null}

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
              <SelectField
                id="task-priority"
                label="How urgent"
                value={priority}
                onValueChange={(value) => setPriority(value as TaskPriority)}
                options={TASK_PRIORITY_OPTIONS}
              />
              <Field>
                <FieldLabel htmlFor="task-notes">Notes</FieldLabel>
                <Textarea
                  id="task-notes"
                  rows={3}
                  maxLength={NOTES_LIMIT}
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
          disabled={saving || !selected || !dueDate || pastDue || (ownOnly && !assignee)}
          aria-busy={saving}
          onClick={() => void submit()}
        >
          {saving ? "Adding…" : "Add follow-up"}
        </Button>
      </DialogActions>
    </>
  );
}
