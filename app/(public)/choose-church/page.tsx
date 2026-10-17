"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { DEMO_ROLE_LABELS, type DemoRole } from "@/types/team";

interface ChurchChoice {
  churchId: string;
  name: string;
  role: DemoRole;
}

/**
 * For an account that belongs to more than one church. The choice is a
 * cookie the server validates on every request, so this page can only offer
 * what the account already has.
 */
export default function ChooseChurchPage() {
  const router = useRouter();
  const [churches, setChurches] = useState<ChurchChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/churches", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const envelope = (await response.json()) as {
          ok: boolean;
          data?: { churches: ChurchChoice[] };
          error?: string;
          code?: string;
        };
        if (!envelope.ok || !envelope.data) {
          if (envelope.code === "unauthenticated") {
            router.replace("/sign-in");
            return;
          }
          setError(envelope.error ?? "Could not load your churches.");
          return;
        }
        setChurches(envelope.data.churches);
      })
      .catch(() => setError("Could not reach the server."));
    return () => controller.abort();
  }, [router]);

  async function choose(churchId: string) {
    setChoosing(churchId);
    const response = await fetch("/api/churches/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ churchId }),
    });
    if (!response.ok) {
      setError("That church could not be opened.");
      setChoosing(null);
      return;
    }
    // A full load: the store must start empty for the new church.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/dashboard");
  }

  return (
    <AuthShell
      title="Which church?"
      description="Your account belongs to more than one church. Choose the one to open; you can switch at any time."
    >
      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>
            <span className="block">{error}</span>
            <span className="block">Refresh the page to try again.</span>
          </AlertDescription>
        </Alert>
      ) : null}
      {churches === null && !error ? (
        <p role="status" className="text-base text-muted-foreground">
          Finding your churches…
        </p>
      ) : null}
      {churches?.length ? (
        <ul className="space-y-3">
          {churches.map((church) => (
            <li key={church.churchId}>
              <Button
                variant="outline"
                className="h-auto min-h-16 w-full justify-between gap-3 rounded-2xl px-5 py-3 text-left whitespace-normal"
                disabled={choosing !== null}
                onClick={() => void choose(church.churchId)}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="font-heading text-lg font-medium">{church.name}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {choosing === church.churchId ? "Opening…" : DEMO_ROLE_LABELS[church.role]}
                  </span>
                </span>
                <ArrowRightIcon className="size-5 text-muted-foreground" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {churches?.length === 0 ? (
        <p className="text-base text-muted-foreground">
          Your account isn&apos;t linked to a church yet. Ask your church administrator to send you
          an invitation.
        </p>
      ) : null}
    </AuthShell>
  );
}
