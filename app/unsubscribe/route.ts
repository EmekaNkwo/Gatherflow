import { recordAudit, SYSTEM_USER } from "@/server/audit/audit";
import { getDatabase } from "@/server/db/client";
import { readMailjetConfig } from "@/server/email/mailjet";
import { applyUnsubscribe, verifyUnsubscribe } from "@/server/email/unsubscribe";

/**
 * The page behind every email's unsubscribe link and `List-Unsubscribe`
 * header.
 *
 * A route handler rather than a page because mail clients implementing
 * one-click unsubscribe (RFC 8058) send a `POST` with the body
 * `List-Unsubscribe=One-Click` and no user interaction, and a page cannot
 * receive that. A person following the link gets a `GET` with a confirm
 * button, so that a link-scanning mail gateway opening every URL cannot opt
 * somebody out by accident; the button posts to the same URL.
 *
 * Deliberately outside the application shell: no sidebar, no data load, no
 * session. The person was sent here from their inbox and may never have
 * opened the application.
 */
export async function GET(request: Request): Promise<Response> {
  const config = readMailjetConfig();
  if (!config.ok) return page(503, "Unsubscribe is not available", config.error);

  const params = new URL(request.url).searchParams;
  const verified = verifyUnsubscribe(config.value.unsubscribeSecret, params);
  if (!verified.ok) {
    return page(
      400,
      "This link is not valid",
      "It may have been copied incompletely. Reply to the email you received and ask to be removed instead.",
    );
  }

  return page(
    200,
    "Stop receiving emails?",
    "Confirm and the church will no longer email you. Any planned follow-up with you will be cancelled.",
    `<form method="post"><button type="submit">Unsubscribe</button></form><p class="hint">Changed your mind? Just close this page and nothing will change.</p>`,
  );
}

export async function POST(request: Request): Promise<Response> {
  const config = readMailjetConfig();
  if (!config.ok) return page(503, "Unsubscribe is not available", config.error);

  const params = new URL(request.url).searchParams;
  const verified = verifyUnsubscribe(config.value.unsubscribeSecret, params);
  if (!verified.ok) {
    return page(400, "This link is not valid", "It may have been copied incompletely.");
  }

  const outcome = await applyUnsubscribe(getDatabase(), verified.value);
  await recordAudit(getDatabase(), {
    churchId: verified.value.churchId,
    userId: SYSTEM_USER,
    action: "email.unsubscribe_link",
    targetId: verified.value.personId,
    outcome: outcome.ok ? "ok" : "failed",
    code: outcome.ok ? null : outcome.code,
  });
  if (!outcome.ok) {
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        event: "email.unsubscribe.failed",
        churchId: verified.value.churchId,
        error: outcome.error,
      }),
    );
    return page(
      500,
      "Something went wrong",
      "Your request was received but could not be recorded. Please try again in a moment.",
    );
  }

  console.info(
    JSON.stringify({
      at: new Date().toISOString(),
      event: "email.unsubscribe",
      churchId: verified.value.churchId,
      changed: outcome.value.changed,
    }),
  );
  return page(
    200,
    "You have been unsubscribed",
    "The church will not email you again. If this was a mistake, get in touch with them directly.",
  );
}

/**
 * A self-contained page with no scripts and no external assets, so it renders
 * in the most restrictive mail-client browser and gives a scanner nothing to
 * follow.
 */
function page(status: number, title: string, text: string, extra = ""): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 40px 16px; font-family: "Atkinson Hyperlegible Next", "Atkinson Hyperlegible", system-ui, sans-serif; font-size: 17px; line-height: 1.55; background: oklch(0.982 0.008 80); color: oklch(0.255 0.022 50); }
  main { max-width: 30rem; margin: 0 auto; background: oklch(0.955 0.03 70); border-radius: 2rem; padding: 32px 24px; }
  .mark { display: inline-flex; width: 40px; height: 40px; border-radius: 30%; align-items: center; justify-content: center; background: oklch(0.505 0.13 38); color: oklch(0.985 0.008 80); margin-bottom: 24px; }
  h1 { font-family: Nunito, ui-rounded, system-ui, sans-serif; font-weight: 750; font-size: 1.85rem; line-height: 1.15; margin: 0 0 12px; }
  p { margin: 0 0 24px; }
  .hint { margin: 16px 0 0; font-size: 0.9rem; color: oklch(0.47 0.022 55); }
  button { font: inherit; font-weight: 600; width: 100%; min-height: 48px; padding: 12px 24px; border-radius: 999px; border: 0; background: oklch(0.505 0.13 38); color: oklch(0.985 0.008 80); cursor: pointer; }
  button:focus-visible { outline: 3px solid oklch(0.6 0.11 40 / 50%); outline-offset: 2px; }
  @media (min-width: 480px) { main { padding: 40px; } button { width: auto; } }
  @media (prefers-color-scheme: dark) {
    body { background: oklch(0.195 0.012 50); color: oklch(0.93 0.014 75); }
    main { background: oklch(0.255 0.025 50); }
    .mark, button { background: oklch(0.74 0.115 45); color: oklch(0.2 0.02 45); }
    .hint { color: oklch(0.74 0.02 65); }
  }
</style>
</head>
<body><main><span class="mark" aria-hidden="true">${MARK}</span><h1>${escape(title)}</h1><p>${escape(text)}</p>${extra}</main></body>
</html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      // The token is in the URL: keep it out of referrers, and keep the page
      // out of frames.
      "referrer-policy": "no-referrer",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

/** GatherFlow's mark, inline so the page still loads nothing external. */
const MARK = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none"><path d="M4.5 13a7.5 7.5 0 0 1 12.8-5.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M19.5 11a7.5 7.5 0 0 1-12.8 5.3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2.1" fill="currentColor"/></svg>`;

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
