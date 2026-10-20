"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { useAddMemberStore } from "@/stores/add-member-store";

/**
 * Opens "Add a member". Renders nothing for a role that cannot add people,
 * so callers need no permission check of their own.
 */
export function AddMemberButton({ children, ...props }: Omit<ComponentProps<typeof Button>, "onClick">) {
  const show = useAddMemberStore((state) => state.show);
  const { can } = useRole();
  if (!can("people.write")) return null;
  return (
    <Button {...props} onClick={show}>
      {children}
    </Button>
  );
}
