"use client";

import { useState } from "react";
import { HomeIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader, PageShell } from "@/components/shared/page-header";
import { PersonCell, personHref } from "@/components/shared/person-cell";
import { useDemoRole } from "@/hooks/useDemoRole";
import { useMembers } from "@/hooks/useMembers";

/**
 * Households group people who live together, which is how a church team
 * usually thinks about visiting and contacting families.
 */
export default function HouseholdsPage() {
  const { can } = useDemoRole();
  const { households, addHousehold } = useMembers();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");

  const canEdit = can("people.write");

  return (
    <PageShell>
      <PageHeader
        title="Households"
        description="Only an area is recorded, not a full address — the church needs to know roughly where people are, not exactly where they live."
        actions={
          canEdit ? (
            <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
              <PlusIcon />
              New household
            </Button>
          ) : null
        }
      />

      {households.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {households.map(({ household, members }) => (
            <Card key={household.id}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  <span className="truncate">{household.name}</span>
                  <Badge variant="outline">{members.length}</Badge>
                </CardTitle>
                <CardDescription>{household.area ?? "Area not recorded"}</CardDescription>
              </CardHeader>
              <CardContent>
                {members.length ? (
                  <ul className="space-y-2">
                    {members.map((person) => (
                      <li key={person.id}>
                        <PersonCell
                          person={person}
                          href={personHref(person)}
                          subtitle={
                            person.member
                              ? `Member ${person.member.reference}`
                              : "Visitor record"
                          }
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nobody is assigned to this household yet. Assign people from their own record.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={HomeIcon}
          title="No households yet"
          description="Create a household and assign people to it from their member record."
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
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="household-area">Area</FieldLabel>
            <Input
              id="household-area"
              value={area}
              onChange={(event) => setArea(event.target.value)}
              placeholder="Riverside"
            />
            <FieldDescription>An area or district only — no street addresses.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button
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
