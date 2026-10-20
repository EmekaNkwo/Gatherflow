"use client";

import { DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { MemberForm } from "@/components/members/member-form";
import { useRole } from "@/hooks/useRole";
import { useAddMemberStore } from "@/stores/add-member-store";

/**
 * "Add a member", as a modal over whatever the person was doing — a sheet
 * from the bottom on a phone. Saving closes it and opens the new record.
 *
 * Mounted once, in the app shell. Open it with `useAddMemberStore().show()`
 * or an `AddMemberButton`.
 */
export function AddMemberDialog() {
  const open = useAddMemberStore((state) => state.open);
  const opening = useAddMemberStore((state) => state.opening);
  const hide = useAddMemberStore((state) => state.hide);
  const { can } = useRole();

  if (!can("people.write")) return null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && hide()}
      title="Add a member"
      description="For someone joining directly. If they've visited before, make them a member from their visitor page so their story carries over."
      className="sm:max-w-xl"
    >
      <DialogBody className="pb-6">
        {/* Keyed on each opening, so it starts with an empty form. */}
        <MemberForm key={opening} onDone={hide} onCancel={hide} />
      </DialogBody>
    </ResponsiveDialog>
  );
}
