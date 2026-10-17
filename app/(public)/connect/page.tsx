import { AuthLink, AuthShell } from "@/components/auth/auth-shell";

/** Reached without a church in the link: nothing to register against. */
export default function ConnectIndexPage() {
  return (
    <AuthShell
      title="Looking for a church's welcome page?"
      description="Each church has its own link, printed as a QR code on its welcome card. Scan the code at the welcome desk, or ask someone there for the link."
      footer={<AuthLink href="/">About GatherFlow</AuthLink>}
    >
      <p className="text-base text-muted-foreground">
        It only takes a minute, and you choose whether the church gets in touch.
      </p>
    </AuthShell>
  );
}
