import Link from "next/link";

/**
 * The last resort, outside the app: for addresses no part of the app claims.
 * Kept plain, because the app's data and menu aren't available here.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 bg-background px-4 py-16 text-center">
      <h1 className="font-heading text-3xl font-medium">We can&apos;t find that page</h1>
      <p className="max-w-md text-muted-foreground">
        The link may be old or mistyped. Nothing else has changed.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center rounded-full bg-primary px-6 font-medium text-primary-foreground"
        >
          Back to Today
        </Link>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-full border px-6 font-medium">
          Start page
        </Link>
      </div>
    </main>
  );
}
