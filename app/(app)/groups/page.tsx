"use client";

import { meetsLabel } from "@/lib/groups";
import { useRef, useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, PlusIcon, ShieldIcon, UsersRoundIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { SelectField, type SelectOption } from "@/components/shared/select-field";
import { personHref } from "@/components/shared/person-cell";
import { displayName } from "@/lib/strings";
import {
  GROUP_TYPES,
  GROUP_TYPE_LABELS,
  WEEKDAYS,
  type GroupType,
  type Weekday,
} from "@/types/group";
import { useRole } from "@/hooks/useRole";
import { useGroups } from "@/hooks/useGroups";

/** How many people without a group show before "Show all". */
const UNCONNECTED_PREVIEW = 6;

const GROUP_TYPE_OPTIONS: SelectOption[] = GROUP_TYPES.map((option) => ({
  value: option,
  label: GROUP_TYPE_LABELS[option],
}));

/** Weekdays are stored lower-case; show them capitalised, as the old select did with CSS. */
const WEEKDAY_OPTIONS: SelectOption[] = WEEKDAYS.map((day) => ({
  value: day,
  label: day.charAt(0).toUpperCase() + day.slice(1),
}));


/**
 * Groups: what groups exist, who leads them and when they meet, then the
 * members who are not in one yet. Nobody is added to a group automatically.
 */
export default function GroupsPage() {
  const { groups, unconnected, create } = useGroups();
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const { canRun } = useRole();
  const canEdit = canRun("group.create", { name: "", description: "", type: "connect_group" });
  const activeCount = groups.filter((entry) => entry.group.active).length;
  const shownUnconnected = showAll ? unconnected : unconnected.slice(0, UNCONNECTED_PREVIEW);

  return (
    <PageShell className="max-w-4xl space-y-10">
      <PageHeader
        title="Groups"
        description={
          groups.length
            ? `${activeCount} group${activeCount === 1 ? "" : "s"} meeting${
                unconnected.length ? ` · ${unconnected.length} members not in one yet` : ""
              }`
            : "Connect groups, teams and ministries."
        }
        actions={
          canEdit ? (
            <Button className="min-h-11 gap-1.5 rounded-full" onClick={() => setCreating(true)}>
              <PlusIcon />
              New group
            </Button>
          ) : null
        }
      />

      {groups.length ? (
        <ul className="divide-y overflow-hidden rounded-3xl border bg-card" aria-label="Groups">
          {groups.map(({ group, leader, members }) => (
            <li key={group.id}>
              <Link
                href={`/groups/${group.id}`}
                className="flex min-h-16 items-center gap-3 px-5 py-4 hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{group.name}</span>
                    {group.involvesMinors ? (
                      <ShieldIcon
                        className="size-4 shrink-0 text-muted-foreground"
                        aria-label="Works with under-18s"
                      />
                    ) : null}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {GROUP_TYPE_LABELS[group.type]} · Led by {leader ? displayName(leader) : "nobody yet"}
                  </span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {group.schedule ? meetsLabel(group.schedule) : "No regular meeting time"}
                    {group.location ? ` · ${group.location}` : ""}
                  </span>
                </span>
                {group.active ? (
                  <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                    {members.length} {members.length === 1 ? "person" : "people"}
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Not meeting
                  </span>
                )}
                <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={UsersRoundIcon}
          title="No groups yet"
          description="Create a connect group or ministry team to start keeping track of who is involved."
        />
      )}

      <Section
        title="Not in a group yet"
        description="A group is a simple way to stay connected, not a measure of anybody's commitment."
      >
        {unconnected.length ? (
          <>
            <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
              {shownUnconnected.map((person) => (
                <li key={person.id}>
                  <Link
                    href={personHref(person)}
                    className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-muted/50"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium">{displayName(person)}</span>
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
            {unconnected.length > UNCONNECTED_PREVIEW ? (
              <Button variant="ghost" className="min-h-11 rounded-full" onClick={() => setShowAll((all) => !all)}>
                {showAll ? "Show fewer" : `Show all ${unconnected.length}`}
              </Button>
            ) : null}
          </>
        ) : (
          <p className="rounded-2xl bg-muted px-5 py-4 text-muted-foreground">
            {groups.some((group) => group.members.length)
              ? "Everyone is in at least one group."
              : "Nobody is listed here yet. Members who aren't in a group will show here."}
          </p>
        )}
      </Section>

      <CreateGroupDialog
        open={creating}
        onOpenChange={setCreating}
        onConfirm={async (values) => {
          const outcome = await create(values);
          if (outcome.ok) setCreating(false);
        }}
      />
    </PageShell>
  );
}

function CreateGroupDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (values: {
    name: string;
    description: string;
    type: GroupType;
    location?: string;
    involvesMinors: boolean;
    schedule: { weekday: Weekday; time: string; frequency: "weekly" | "fortnightly" | "monthly" };
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  // In-flight guard: one tap, one group, however quickly it's pressed again.
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const [description, setDescription] = useState("");
  const [type, setType] = useState<GroupType>("connect_group");
  const [weekday, setWeekday] = useState<Weekday>("tuesday");
  const [time, setTime] = useState("19:00");
  const [location, setLocation] = useState("");
  const [involvesMinors, setInvolvesMinors] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            If the group works with under-18s, tick the box at the bottom so their details stay
            inside the group.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="group-name">Name</FieldLabel>
          <Input id="group-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <Field>
          <FieldLabel htmlFor="group-description">Description</FieldLabel>
          <Textarea
            id="group-description"
            rows={2}
            maxLength={500}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            id="group-type"
            label="Type"
            value={type}
            onValueChange={(value) => setType(value as GroupType)}
            options={GROUP_TYPE_OPTIONS}
          />
          <Field>
            <FieldLabel htmlFor="group-location">Location</FieldLabel>
            <Input
              id="group-location"
              maxLength={120}
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </Field>
          <SelectField
            id="group-weekday"
            label="Meets on"
            value={weekday}
            onValueChange={(value) => setWeekday(value as Weekday)}
            options={WEEKDAY_OPTIONS}
          />
          <Field>
            <FieldLabel htmlFor="group-time">Time</FieldLabel>
            <Input
              id="group-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
        </div>

        <Field orientation="horizontal">
          <Checkbox
            id="group-minors"
            checked={involvesMinors}
            onCheckedChange={(checked) => setInvolvesMinors(checked === true)}
          />
          <FieldLabel htmlFor="group-minors" className="font-normal">
            This group works with under-18s
          </FieldLabel>
        </Field>

        <DialogFooter>
          <Button variant="outline" size="lg" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="lg"
            className="rounded-full"
            disabled={!name.trim() || saving}
            aria-busy={saving}
            onClick={async () => {
              if (inFlight.current) return;
              inFlight.current = true;
              setSaving(true);
              try {
                await onConfirm({
                  name,
                  description,
                  type,
                  location: location || undefined,
                  involvesMinors,
                  schedule: { weekday, time, frequency: "weekly" },
                });
              } finally {
                inFlight.current = false;
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
