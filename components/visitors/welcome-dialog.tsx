"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogBody, ResponsiveDialog } from "@/components/people/responsive-dialog";
import { SelectField } from "@/components/shared/select-field";
import { QuickRegisterForm } from "@/components/visitors/quick-register-form";
import { VisitorForm } from "@/components/visitors/visitor-form";
import { formatDisplayDate, toIsoDate } from "@/lib/dates";
import { useSnapshot } from "@/hooks/use-church-data";
import { useNow } from "@/hooks/use-now";
import { useRole } from "@/hooks/useRole";
import { useWelcomeStore } from "@/stores/welcome-store";

/**
 * Welcoming somebody new, as a modal that opens over whatever the person was
 * doing — a sheet from the bottom on a phone. Two forms, one switch away:
 * the quick welcome (the service is chosen once, then people are added one
 * after another, and it stays open for the next person) and the full form
 * (everything, then on to the new record).
 *
 * Mounted once, in the app shell. Open it with `useWelcomeStore().show()`
 * or a `WelcomeButton`.
 */
export function WelcomeDialog() {
  const open = useWelcomeStore((state) => state.open);
  const mode = useWelcomeStore((state) => state.mode);
  const opening = useWelcomeStore((state) => state.opening);
  const sessionId = useWelcomeStore((state) => state.sessionId);
  const hide = useWelcomeStore((state) => state.hide);
  const { can } = useRole();

  if (!can("visitors.write")) return null;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(next) => !next && hide()}
      title="Welcome someone new"
      description={
        mode === "full"
          ? "Everything you know about them. A name is still enough to start."
          : "A name is enough to start. We’ll make sure somebody says hello."
      }
      className="sm:max-w-xl"
    >
      {/* Keyed on each opening and mode, so each starts with an empty form. */}
      {mode === "full" ? (
        <FullBody key={`${opening}-full`} initialSessionId={sessionId} />
      ) : (
        <WelcomeBody key={`${opening}-quick`} initialSessionId={sessionId} />
      )}
    </ResponsiveDialog>
  );
}

function WelcomeBody({ initialSessionId }: { initialSessionId: string | undefined }) {
  const now = useNow();
  const snapshot = useSnapshot();
  const setMode = useWelcomeStore((state) => state.setMode);

  // Recent services, plus the one it was opened for if that is upcoming
  // (check-in on the morning of a service).
  const sessions = useMemo(() => {
    const recent = [...snapshot.sessions]
      .filter((session) => session.date <= toIsoDate(now))
      .sort((left, right) => (left.date < right.date ? 1 : -1))
      .slice(0, 6);
    const requested = snapshot.sessions.find((session) => session.id === initialSessionId);
    return requested && !recent.some((session) => session.id === requested.id) ? [requested, ...recent] : recent;
  }, [snapshot.sessions, now, initialSessionId]);

  const [sessionId, setSessionId] = useState(initialSessionId ?? sessions[0]?.id ?? "");
  const chosen = sessions.find((session) => session.id === sessionId);

  return (
    <DialogBody className="space-y-6 pb-6">
      <details className="group rounded-2xl bg-muted px-4 py-3">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3">
          <span>
            {chosen ? (
              <>
                Checking them in to <strong>{chosen.name}</strong>, {formatDisplayDate(chosen.date)}
              </>
            ) : (
              "Not checking them in to a service"
            )}
          </span>
          <span className="text-sm font-medium text-primary">Change</span>
        </summary>
        <SelectField
          id="quick-session"
          label="Service"
          className="mt-3 max-w-sm"
          value={sessionId}
          onValueChange={setSessionId}
          options={[
            { value: "", label: "Don't check them in" },
            ...sessions.map((session) => ({
              value: session.id,
              label: `${session.name} · ${formatDisplayDate(session.date)}`,
            })),
          ]}
        />
      </details>

      <QuickRegisterForm sessionId={sessionId || undefined} />

      <SwitchLine
        lead="Need to record more, like an address or household?"
        action="Use the full form"
        onSwitch={() => setMode("full")}
      />
    </DialogBody>
  );
}

function FullBody({ initialSessionId }: { initialSessionId: string | undefined }) {
  const hide = useWelcomeStore((state) => state.hide);
  const setMode = useWelcomeStore((state) => state.setMode);
  return (
    <DialogBody className="space-y-6 pb-6">
      <VisitorForm defaultSessionId={initialSessionId} onDone={hide} onCancel={hide} />
      <SwitchLine
        lead="At the welcome desk with a queue?"
        action="Use the quick welcome"
        onSwitch={() => setMode("quick")}
      />
    </DialogBody>
  );
}

/** The quiet line at the bottom that swaps one form for the other. */
function SwitchLine({ lead, action, onSwitch }: { lead: string; action: string; onSwitch: () => void }) {
  return (
    <p className="text-sm text-muted-foreground">
      {lead}{" "}
      <Button variant="link" className="h-auto p-0 text-sm font-medium" onClick={onSwitch}>
        {action}
      </Button>
      .
    </p>
  );
}
