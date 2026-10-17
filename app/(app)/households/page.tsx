"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRightIcon, HomeIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { OptedOutBadge } from "@/components/shared/badges";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { personHref } from "@/components/shared/person-cell";
import { displayName } from "@/lib/strings";
import { useRole } from "@/hooks/useRole";
import { useMembers } from "@/hooks/useMembers";

/**
 * Households: families as simple lists of the people in them, which is how
 * a church team usually thinks about visiting and contacting families.
 * Only a rough area is kept, never a street address.
 */
export default function HouseholdsPage() {
  const { can } = useRole();
  const { households, addHousehold } = useMembers();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");

  const canEdit = can("people.write");
  const people = households.reduce((sum, entry) => sum + entry.members.length, 0);

  return (
    <PageShell>
      <PageHeader
        title="Households"
        description={
          households.length
            ? `${households.length} famil${households.length === 1 ? "y" : "ies"} · ${people} ${people === 1 ? "person" : "people"}. Only a rough area is kept, never an address.`
            : "Families and the people in them. Only a rough area is kept, never an address."
        }
        actions={
          canEdit ? (
            <Button className="min-h-11 gap-1.5 rounded-full" onClick={() => setCreating(true)}>
              <PlusIcon />
              New household
            </Button>
          ) : null
        }
      />

      {households.length ? (
        <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2">
          {households.map(({ household, members }) => (
            <section key={household.id} aria-labelledby={`household-${household.id}`} className="space-y-3">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 id={`household-${household.id}`} className="truncate text-xl font-medium">
                  {household.name}
                </h2>
                <p className="shrink-0 text-sm text-muted-foreground">
                  {household.area ?? "Area not recorded"}
                </p>
              </div>
              {members.length ? (
                <ul className="divide-y overflow-hidden rounded-3xl border bg-card">
                  {members.map((person) => (
                    <li key={person.id}>
                      <Link
                        href={personHref(person)}
                        className="flex min-h-14 items-center gap-3 px-5 py-3 hover:bg-muted/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{displayName(person)}</span>
                          <span className="block truncate text-sm text-muted-foreground">
                            {person.member ? "Member" : "Visitor"}
                          </span>
                        </span>
                        {person.contact.optedOut ? <OptedOutBadge className="shrink-0" /> : null}
                        <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-2xl bg-muted px-5 py-4 text-muted-foreground">
                  Nobody in this household yet. Add people from their own page.
                </p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={HomeIcon}
          title="No households yet"
          description="Create a household, then add people to it from their own page."
        />
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New household</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="household-name">Name</FieldLabel>
            <Input
              id="household-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="The Adeyemi household"
              className="h-11"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="household-area">Area</FieldLabel>
            <Input
              id="household-area"
              value={area}
              onChange={(event) => setArea(event.target.value)}
              placeholder="Riverside"
              className="h-11"
            />
            <FieldDescription>An area or district only, never a street address.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" size="lg" className="rounded-full" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
              size="lg"
              className="rounded-full"
              disabled={!name.trim()}
              onClick={async () => {
                const outcome = await addHousehold({ name, area: area || undefined });
                if (outcome.ok) {
                  setCreating(false);
                  setName("");
                  setArea("");
                }
              }}
            >
              Create household
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
