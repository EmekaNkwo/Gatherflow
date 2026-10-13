"use client";

import { useState } from "react";
import Link from "next/link";
import { PlusIcon, ShieldIcon, UsersRoundIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, PageShell, Section } from "@/components/shared/page-header";
import { PersonCell, personHref } from "@/components/shared/person-cell";
import { displayName } from "@/lib/strings";
import { GROUP_TYPES, GROUP_TYPE_LABELS, WEEKDAYS, type GroupType, type Weekday } from "@/types/group";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useGroups } from "@/hooks/useGroups";

/** Groups and ministries, plus the members who are not yet in one. */
export default function GroupsPage() {
  const { can } = useDemoRole();
  const { groups, unconnected, create } = useGroups();
  const [creating, setCreating] = useState(false);

  const canEdit = can("groups.write");

  return (
    <PageShell>
      <PageHeader
        title="Groups & ministries"
        description="Nobody is added to a group automatically. Every membership records who added them and when."
        actions={
          canEdit ? (
            <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
              <PlusIcon />
              New group
            </Button>
          ) : null
        }
      />

      {groups.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map(({ group, leader, members }) => (
            <Card key={group.id} className={group.active ? undefined : "opacity-70"}>
              <CardHeader>
                <CardTitle className="flex items-start justify-between gap-2">
                  <Link href={`/groups/${group.id}`} className="truncate hover:underline">
                    {group.name}
                  </Link>
                  <Badge variant={group.active ? "secondary" : "outline"}>
                    {group.active ? GROUP_TYPE_LABELS[group.type] : "Inactive"}
                  </Badge>
                </CardTitle>
                <CardDescription>{group.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{members.length} members</span>
                  {group.schedule ? (
                    <span className="capitalize">
                      · {group.schedule.weekday} {group.schedule.time} ({group.schedule.frequency})
                    </span>
                  ) : null}
                  {group.location ? <span>· {group.location}</span> : null}
                </div>

                {group.involvesMinors ? (
                  <p className="flex items-start gap-1.5 rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground">
                    <ShieldIcon className="mt-0.5 size-3.5 shrink-0" />
                    Works with under-18s. Member details are shown only inside the group record.
                  </p>
                ) : null}

                <p className="text-xs text-muted-foreground">
                  Led by {leader ? displayName(leader) : "nobody yet"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={UsersRoundIcon}
          title="No groups yet"
          description="Create a connect group or ministry team to start recording who is involved."
        />
      )}

      <Section
        title={`Members not in a group (${unconnected.length})`}
        description="The people most likely to drift. Being in a group is not a measure of anybody's commitment — it is simply a practical way to stay connected."
      >
        {unconnected.length ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {unconnected.slice(0, 18).map((person) => (
              <li key={person.id} className="rounded-lg border p-2">
                <PersonCell
                  person={person}
                  href={personHref(person)}
                  subtitle={person.member ? `Member ${person.member.reference}` : undefined}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Everyone is in at least one group.</p>
        )}
      </Section>

      <CreateGroupDialog
        open={creating}
        onOpenChange={setCreating}
        onConfirm={(values) => {
          const outcome = create(values);
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
  }) => void;
}) {
  const [name, setName] = useState("");
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
            Groups that work with under-18s are flagged so their details stay inside the group
            record.
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor="group-name">Name</FieldLabel>
          <Input id="group-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <Field>
          <FieldLabel htmlFor="group-description">Description</FieldLabel>
          <Textarea
            id="group-description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="group-type">Type</FieldLabel>
            <NativeSelect
              className="w-full"
              id="group-type"
              value={type}
              onChange={(event) => setType(event.target.value as GroupType)}
            >
              {GROUP_TYPES.map((option) => (
                <NativeSelectOption key={option} value={option}>
                  {GROUP_TYPE_LABELS[option]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="group-location">Location</FieldLabel>
            <Input
              id="group-location"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="group-weekday">Meets on</FieldLabel>
            <NativeSelect
              className="w-full"
              id="group-weekday"
              value={weekday}
              onChange={(event) => setWeekday(event.target.value as Weekday)}
            >
              {WEEKDAYS.map((day) => (
                <NativeSelectOption key={day} value={day} className="capitalize">
                  {day}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim()}
            onClick={() =>
              onConfirm({
                name,
                description,
                type,
                location: location || undefined,
                involvesMinors,
                schedule: { weekday, time, frequency: "weekly" },
              })
            }
          >
            Create group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
