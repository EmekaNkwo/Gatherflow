"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { useWelcomeStore, type WelcomeMode } from "@/stores/welcome-store";

type WelcomeButtonProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  /** Check the people added in to this service, e.g. from its check-in. */
  sessionId?: string;
  /** Open on the full form instead of the quick welcome. */
  mode?: WelcomeMode;
};

/**
 * Opens "Welcome someone new". Renders nothing for a role that cannot
 * register visitors, so callers need no permission check of their own.
 */
export function WelcomeButton({ sessionId, mode, children, ...props }: WelcomeButtonProps) {
  const show = useWelcomeStore((state) => state.show);
  const { can } = useRole();
  if (!can("visitors.write")) return null;
  return (
    <Button {...props} onClick={() => show({ sessionId, mode })}>
      {children}
    </Button>
  );
}
