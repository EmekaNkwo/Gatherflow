"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogActions, DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { SelectField } from "@/components/shared/select-field";
import { useChurchSettings } from "@/hooks/useChurchSettings";
import { useSnapshot } from "@/hooks/use-church-data";
import { openTasksFor } from "@/services/settings/settings";
import type { TeamMember } from "@/types/team";

interface ReassignDialogProps {
  /** The person whose open follow-ups are moving; `null` keeps it closed. */
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Offers to move every open follow-up from someone who has stepped back to
 * somebody active, in one go, so nothing sits with a person who won't see it.
 */
export function ReassignDialog({ member, onOpenChange }: ReassignDialogProps) {
  const settings = useChurchSettings();
  const snapshot = useSnapshot();
  const count = member ? openTasksFor(snapshot, member.id).length : 0;
  const candidates = settings.team.filter(
    (entry) => entry.active && entry.role !== "member" && entry.id !== member?.id,
  );
  const [to, setTo] = useState("");
  const [moving, setMoving] = useState(false);
  const chosen = candidates.some((entry) => entry.id === to) ? to : (candidates[0]?.id ?? "");

  async function move() {
    if (!member || !chosen || moving) return;
    setMoving(true);
    const outcome = await settings.reassignOpenTasks(member.id, chosen);
    setMoving(false);
    if (outcome.ok) onOpenChange(false);
  }

  return (
    <ResponsiveDialog
      open={Boolean(member) && count > 0}
      onOpenChange={onOpenChange}
      title={member ? `Move ${member.name}'s follow-ups?` : "Move follow-ups"}
      description={
        member
          ? `${count} open follow-up${count === 1 ? " is" : "s are"} still with ${member.name}, who won't get new work now. Give ${count === 1 ? "it" : "them all"} to someone active.`
          : null
      }
    >
      <DialogBody>
        {candidates.length ? (
          <SelectField
            id="reassign-to"
            label="Give them to"
            value={chosen}
            onValueChange={setTo}
            options={candidates.map((entry) => ({ value: entry.id, label: entry.name }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            There&apos;s nobody else active on the team yet. Add or switch someone on, then move these follow-ups.
          </p>
        )}
      </DialogBody>
      <DialogActions>
        <Button variant="outline" size="lg" className="flex-1" onClick={() => onOpenChange(false)}>
          Not now
        </Button>
        <Button size="lg" className="flex-1" disabled={!chosen || moving} onClick={() => void move()}>
          {moving ? "Moving…" : `Move all ${count}`}
        </Button>
      </DialogActions>
    </ResponsiveDialog>
  );
}
