# GatherFlow

Church membership, first-time visitor follow-up and engagement — as an operations system
rather than a set of dashboard screens.

GatherFlow answers three questions on a busy Sunday: **who attended, who needs attention, and
what should the team do next?** A visitor is registered at the welcome desk, a volunteer is made
responsible for them, the welcome message goes out, the outcome of that conversation decides
what happens next, and their return visit, membership and group connection are all recorded
against the same person.

> **One deployment, many churches.** Somebody creates a church and becomes its administrator,
> invites the team by email with links that carry a role, prints the church's own welcome page for a QR
> code, and the server enforces every rule from then on: who may see what, who may contact whom,
> and what the email provider actually reported. There is no demo mode, no sample data and no
> browser-side storage; a new church starts empty, with the built-in templates and default rules.

---

## Running it

```bash
cp .env.example .env.local        # set DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL at least

docker run -d --name gatherflow-pg \
  -e POSTGRES_USER=gatherflow -e POSTGRES_PASSWORD=gatherflow \
  -e POSTGRES_DB=gatherflow -p 5466:5432 postgres:17-alpine

npm install
npm run db:migrate                # apply migrations before the first run
npm run dev                       # http://localhost:3000
```

Open the landing page, choose **Create your church**, and you are its administrator. Everything
else — the team, the welcome page, the message templates, email — is set up from Settings.

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Vitest: the business rules, plus the server suites when `TEST_DATABASE_URL` is set |
| `npm run test:db` | The server suites on their own (persistence, authorisation, email, audit, backup) |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm run e2e` | Playwright end-to-end suite against Postgres and a stub mail provider (builds first) |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle migrations and a database browser |
| `npm run email:check-dns -- <domain>` | Checks a sending domain's SPF, DKIM and DMARC records |

`.env.example` is the reference for configuration: the database, the auth secret and public
origin, the Mailjet credentials, the `EMAIL_SENDING_ENABLED` gate, the pilot allowlist, the
unsubscribe signing secret and the operator secret (`CRON_SECRET`).

### The routes

| Route | What it is |
| --- | --- |
| `/` | The landing page |
| `/sign-up` | Creates an account and a church; the creator is its administrator |
| `/sign-in`, `/forgot-password`, `/reset-password` | Email and password; the reset link goes out as transactional mail when Mailjet is configured |
| `/onboarding` | For an account that belongs to no church yet: create one, or use an invitation |
| `/accept-invite?token=…` | The end of an invitation link: sign in or sign up with the invited address, and join |
| `/choose-church` | For an account in more than one church |
| `/account` | The signed-in person's own account, whatever their role: address, password, daily reminders, deleting it |
| `/dashboard` and the rest of the shell | The operations interface |
| `/connect/<churchId>` | The church's public welcome page, outside the shell, which posts to `POST /api/public/connect` |
| `/unsubscribe` | The signed link every email carries |

---

## Architecture

The rule that shapes the codebase: **UI components render and dispatch; they never contain
business rules.**

```
app/                     Routes only — composition, no logic
  (app)/                 The operations shell (sidebar, header, data provider)
  (public)/              Landing, account pages and the visitor welcome page
  api/                   Church, commands, email, churches, invitations, members, ops, webhooks
components/              Presentation, grouped by feature
hooks/                   The API components use: useVisitors, useFollowUps, useAttendance, …
stores/                  Zustand: one snapshot, one dispatch path to the server
services/                All business rules, as pure functions over a snapshot
  core/                  Command context, domain events, immutable snapshot helpers, the empty church
  visitors/ follow-ups/ attendance/ members/ groups/ care/ communications/
  analytics/             Every figure, recounted from records
  automation/            The follow-up rule engine
  commands/              The registry, and the browser's transport to the server
server/                  Postgres, Better Auth, authorisation, audit, email, operator tooling
types/                   The domain model
data/seed/               A deterministic synthetic church, used only by the tests
```

### Commands are named

Every change is a registered command. `services/commands/registry.ts` binds each of the 51
commands to three things that must never drift apart: the capability it requires, a Zod schema
for its input, and the function that applies it. The server uses that entry to decide what to
check and what shape the request body must have, before the function runs. So a command cannot
be exposed over HTTP without declaring what it needs.

Commands are referred to by name because a closure cannot cross a network:

```ts
const { dispatch } = useCommand();
await dispatch("task.complete", { taskId, outcome: "contacted" });
```

The browser sends a name and an input, never a computed snapshot. The server re-runs the rules
itself and decides the new state, so a client that lied about the outcome would be ignored.

Some inputs are deliberately *not* accepted from a client. `task.create` takes no `origin` or
`automationKey`: those belong to the automation engine, and a request able to set them could
fabricate a generated task — or occupy a key and so suppress the real one.

### Commands, not mutations

Every change is a pure function from one snapshot to the next:

```ts
export function completeTask(
  snapshot: ChurchSnapshot,
  input: CompleteTaskInput,
  ctx: CommandContext,
): Result<CommandResult>
```

- **Pure** — no clock, no random ids, no storage. Those arrive in `ctx`, which is why the rules
  are straightforward to test.
- **Refusals are data.** Trying to create a follow-up for someone who opted out returns
  `err("… has asked not to be contacted …", "opted_out")`, which the UI shows as a message.
  Nothing throws.
- **Events, not diffs.** A command reports what happened (`visitor.returned`,
  `task.completed`). The server runs the automation engine once against those events.

The component layer stays thin:

```tsx
const { tasks, counts, complete, reschedule } = useFollowUps({ due: "today" });
```

### Automation that cannot misfire

Rules react to domain events, never to renders, and every generated task carries an
`automationKey` (`first_visit_welcome:<personId>:<date>`). Replaying an event can only produce a
duplicate-key refusal, so a re-render, a double click or a retried request cannot create a second
welcome task. Rules never emit events of their own, so one pass is always enough and no loop is
possible. Each rule can be turned off, retimed and reassigned in Settings.

Overdue work stores nothing at all: it is derived from due dates every time it is displayed, so
it cannot drift out of step.

### Persistence (Postgres)

The persistence seam is `AsyncSnapshotRepository`: the unit of work is a whole church snapshot,
and operations can be awaited. `server/db/snapshot-repository.ts` implements it with Drizzle
over Postgres:

- **Validation on read.** Each record is stored whole in a `jsonb` column and parsed with Zod on
  load. One malformed row is dropped and counted, never thrown; unreadable settings fall back to
  the defaults and are reported, never replaced wholesale.
- **Only what changed is written.** A commit compares array references and rewrites just those
  collections.
- **Optimistic concurrency.** `churches.version` is the guard: a commit states the version it
  read, and one whose guard has been spent is refused with a `conflict` so the caller reloads
  rather than overwriting work it never saw.
- **Invariants enforced by the database.** `tasks_automation_key_unique` (the automation
  idempotency guarantee) and `attendance_session_person_unique` are indexes, which is what makes
  them true across concurrent writers.
- **Deterministic ordering.** Loads are `ORDER BY id`; without it Postgres is free to reshuffle
  every list between reloads.
- **An empty church is a church.** A church with no people is a new one, not a reason to write
  anything into it. The only thing that creates a church is sign-up (or an invitation accepted
  into one that exists), and what it creates is `services/core/empty-church.ts`: no records,
  the built-in templates, the default pipeline and rules, and the founder as the first team
  member.

Alongside `data`, a small set of columns is *promoted* out of each record — those the database
needs to enforce an invariant or answer a query without loading the whole church. They are
derived from the record on write in one place, so they cannot disagree with it. This suits an
access pattern of "load one church" and is deliberately not a fully normalised schema.

The server tests skip themselves when `TEST_DATABASE_URL` is unset, so `npm test` stays green on
a machine with no Postgres. Point it at a throwaway database: the tests create and delete
churches and accounts.

### Authentication and authorization

**Identity** is Better Auth (`server/auth/auth.ts`), mounted at `/api/auth/[...all]`. It answers
only "who is this?". Accounts come from `/sign-up` or from accepting an invitation; passwords are
at least twelve characters, and a reset link is sent as transactional mail through Mailjet.

**People own their accounts.** `/account` is open to every role. Changing the address asks for
the password, sends a link to the new address and a notice to the old one, and changes nothing
until the link is opened; an address already confirmed has to approve the move first. Deleting
the account asks for the password and is refused while the account is a church's only
administrator; otherwise its memberships go and its team members stay, inactive, so the church's
records keep their names (`server/auth/account.ts`). Better Auth's own endpoints for both are
switched off over HTTP — the only way in is `/api/account`, which checks the password and spends
from the shared request budget first.

**Request budgets are global.** Sign-in, sign-up, password reset, the account routes and the
welcome page all count requests in Postgres (`request_budgets`, one atomic upsert per request),
so a deployment running several instances has one budget per address rather than one per
instance. Old windows are pruned by the outbox cron.

**Authority** is the `church_members` row: which church, which role, which `team` member they act
as. It is read from the server's own tables on every request, so a client cannot assert its own
role. `resolveChurchSession` fails closed: no auth session, no membership, or an ambiguous church
all refuse rather than guess, and the interface sends the person to sign in, to onboarding or to
the church chooser accordingly.

**Churches are created and joined, never found.** `POST /api/churches` creates one for the
signed-in account. Everybody else arrives by invitation: an administrator invites an address to a
role (`/api/church/invitations`), the link is emailed to it and also shown once to the
administrator in case the email cannot go, the table keeps only the token's hash, the link
works for seven days, and accepting it requires signing in with that address. Accepting creates
the membership and — unless the invitation attached the person to an existing team member — a
team member in the invited role, so work can be assigned to them at once. Administrators manage
accounts under Settings → Team: change a role, remove an account (its team member stays,
inactive, so history keeps its attribution), withdraw an invitation. An administrator cannot
demote or remove themselves.

**More than one church.** An account that belongs to several churches is asked to choose
(`/choose-church`) and the choice is a cookie naming a church — nothing more. The membership row
is still read on every request, so a cookie naming a church the account is not in is simply
ignored, and a stale one cannot lock anybody out.

**One capability map.** `server/auth/authorize.ts` imports `lib/permissions.ts` — the same module
the interface uses to decide what to show. The button a volunteer cannot see and the request a
volunteer cannot make therefore cannot disagree, and a capability added to a role is added once.
The interface's reading stays advisory; the server's is the decision.

**Scope is applied in SQL, not to the result.** A session without `care.read` does not fetch the
care table at all, and a volunteer's read filters tasks by assignee in the query. Restricted rows
never enter a process that would have to remember to drop them. Administrators are deliberately
excluded from pastoral care, and a test pins that.

**Commands run against the whole church.** `runCommand` authorises, then loads the *full*
snapshot — the rules need every task to recognise a duplicate automation key and every attendance
row to count a visit. Narrowing what a caller may read must not narrow what the rules reason
about. The result is scoped again before it leaves. Commits are retried on a version conflict and
refused after three collisions.

**Every request leaves a trace.** `audit_log` is written by the server for each command,
email send, provider-driven opt-out, unsubscribe, invitation, membership change, backup and
restore — including the ones it refused, with the refusal code. It names the account and the team
member it acted as, the action and the id it was about, and nothing else: no bodies, no notes, no
addresses. Unlike the church's own timeline it is not part of the data, cannot be edited from the
application, and survives a restore. Administrators read it under Settings → Audit.

**Backup and restore are an operator's job.** `GET /api/ops/backup?church=<id>` returns the
whole church, pastoral care included — which is exactly why it sits behind the operator
secret rather than any role, since no role may export care records. It never creates or seeds
anything by looking. `POST /api/ops/restore` puts a backup back under the usual version guard,
and refuses a file that is not whole rather than dropping records. `scripts/church-backup.mjs`
wraps both.

**Requests are validated before they reach a command.** The domain commands take typed input and
trust it. A request body guarantees nothing, so `server/church/input.ts` parses it first and
turns a malformed body into an ordinary refusal instead of an exception.

**The welcome page is the one unauthenticated write.** `POST /api/public/connect` registers a
visitor against the church named in the link. A honeypot field catches form bots, a per-address
budget (shared across instances) stops anybody filling a church from a script, and the response says nothing about whether
the church id exists.

---

### Sending email

> **Off until switched on.** With no Mailjet credentials the composer drafts, copies and hands
> messages to an app you already have. With credentials it *can* send, and with
> `EMAIL_SENDING_ENABLED=true` it *offers* to — a Send button appears in the composer for the
> email channel, and only there. The gate stays shut until a deployment has worked through
> [`docs/email-production-runbook.md`](docs/email-production-runbook.md): DNS, sender
> verification, the webhook, monitoring, and a controlled pilot on an allowlist.

Real sending changes what the application is allowed to claim, so the design
starts from what a provider can actually tell us.

**Nothing is sent during a request.** `POST /api/church/email` writes the
communication record and a `message_outbox` row in the *same transaction*
(`SaveOptions.enlist`), and returns. A worker sends afterwards. There is no
window in which the provider has accepted a message the church has no record
of, or a record claims a send that never left — a test asserts the whole commit
rolls back if the queue row cannot be written. The message a volunteer edited
in the composer is the message that goes; anything with an unfilled
placeholder is refused.

**Four things are checked before anything is queued**, in one place so no
caller can forget: consent, an address, that the address is not on this
church's suppression list, and — while a pilot is running — that it is on the
allowlist. Two volume brakes sit alongside them: a church may queue 200
messages an hour, and the same person cannot be written to twice within ten
minutes; a request past either is refused with 429. And because queue time
is not send time, the worker checks the suppression list and the allowlist
again for every row it claims, so somebody who unsubscribed in the minutes
between is not written to.

**The statuses mean what they say.** `queued` is ours. `sent` means Mailjet
accepted the request. `delivered` means the receiving mail server accepted the
message — Mailjet reports that as its `sent` event, and it is the strongest
claim available. `bounced`, `blocked`, `spam`, `unsubscribed` and `failed` are
all things a provider told us. The other channels — WhatsApp, SMS, phone — are
handed to the person's own app, and the log records only what they did with
the text: *drafted*, *copied* or *opened*. A request can only ever log those
manual statuses; the pipeline statuses are written by the server, and only ever
forward: a delivery report that arrives after a bounce, or a worker finishing
after the webhook got in first, cannot move a record backwards.

**Opens and clicks are deliberately not recorded.** Knowing whether somebody
opened a pastoral message is more than a church needs and more than this
application should store, so those events are accepted and discarded.

**Webhooks are built for a provider that does not sign them.** Mailjet offers
only a secret URL, so: the secret lives in the path and is compared in constant
time; a mismatch returns 404 so probing cannot tell a wrong secret from a wrong
path; nothing in the payload is trusted beyond *identifying* a row we already
created, so a forged event cannot introduce a record; and every event is keyed
by its own contents, so a retry — or a captured replay — is a no-op. The key
and the event's effects commit in one transaction, so a crash half-way leaves
no key and the provider's retry does the whole thing. Every delivery is also
kept whole in `webhook_inbox` with its outcome for a month, so a report that
seems to have gone missing can be found.

**Not every failure is the recipient's fault.** A hard bounce, a spam
complaint, an unsubscribe, or a block Mailjet applied because the address has
bounced before all end the relationship: the address is suppressed for that
church and the person is opted out through the same `setContactPreferences`
command the interface uses, which also cancels their open follow-up work. A
*soft* bounce (a full mailbox, greylisting) or a block caused by our own
content or Mailjet's infrastructure is recorded on the message and changes
nothing about the person.

**Every message carries a way out.** The `List-Unsubscribe` header and the
link in the message point at `/unsubscribe`, signed with an HMAC so that a
guessed person id cannot opt somebody else out. A mail client's one-click
unsubscribe (a bare POST) and a person following the link both work; a repeat
is a no-op. Transactional mail the person asked for — a password reset —
carries no unsubscribe, because there is nothing to unsubscribe from.

**Failures back off and then stop.** A 5xx, 429 or dropped connection is
retried with doubling delay; any other 4xx is permanent, because the same
request will be wrong next time. After five attempts the row is `failed` and
visible — in Settings, and on the health endpoint — rather than looping. Rows
abandoned by a dead worker are reclaimed; a live worker's claim is not. Several
workers can drain the same queue without sending a row twice. Every timestamp
in the queue comes from the database, never from the caller's clock.

```bash
# Unset MAILJET_* and the application just does not offer to send.
curl -XPOST -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/drain-outbox
curl -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/email/health   # 503 when a human is needed
```

The drain is scheduled by the host, not by the application: `vercel.json` declares it as a
Vercel cron, `.github/workflows/drain-outbox.yml` runs it from GitHub Actions for any other host
once two secrets are set, and the runbook covers a platform cron that just `curl`s.

| Table | Holds |
| --- | --- |
| `message_outbox` | Queued sends, attempts, backoff, provider ids |
| `email_suppression` | Addresses this church must not write to again, and why |
| `webhook_events` | Events already applied, so a replay changes nothing |
| `webhook_inbox` | Every delivery as received, with its outcome or its failure |
| `invitations` | Open and accepted invitations, by token hash |
| `request_budgets` | Requests spent per address and endpoint in the current window |
| `push_subscriptions` | Browsers that turned on daily reminders, per account |
| `audit_log` | Who did what, including what was refused |

### Daily reminders

A person can turn on a daily reminder for their browser under `/account`. It arrives through Web
Push with GatherFlow closed, and says only how many follow-ups are due or overdue for them —
counts, never names, because the message travels through the browser vendor's push service.
Someone in several churches gets one message covering all of them.

```bash
npx web-push generate-vapid-keys   # once; set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
curl -XPOST -H "authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/reminders
```

The first call of a UTC day sends that day's reminders; each browser gets at most one a day, so
later calls only retry failures. `vercel.json` schedules it at 07:00 UTC, and
`.github/workflows/send-reminders.yml` runs it at 07:00, 10:00 and 13:00 for other hosts.
Subscriptions are only accepted for the browsers' own push services, so the run cannot be pointed
at an arbitrary address. Without VAPID keys the Account page says reminders are not set up.

---

## Privacy and data handling

Church participation is sensitive information, and the design treats it that way.

- **Consent is opt-in.** Registration defaults to *no* contact permission. Without it no message
  is drafted and no contact task is created — the record still exists so nobody asks twice.
- **Opt-out always wins.** It cancels open follow-up work, blocks message drafting at the service
  level, and is shown as a badge wherever the person appears.
- **Follow-up stops.** After the church's agreed number of unanswered attempts the record closes
  as "no response". "Not interested" and "referred to another team" close it immediately. Nothing
  re-opens it automatically.
- **Pastoral care is restricted.** It never appears in the dashboard feed, in global search or in
  any export. Notes are explicitly marked restricted. Only a coarse category and short summary are
  modelled — no medical or financial detail.
- **Exports are minimal.** CSV exports exclude private notes. The only thing that contains
  pastoral care is an operator's backup, which no role can request.
- **Attendance stays personal.** Individual attendance history appears on the person's own record;
  shared dashboards only ever show counts.
- **Correction and deletion.** Records can be corrected, and deletion removes the person with all
  their attendance, tasks, messages and timeline. The audit entry left behind deliberately
  contains no personal details.
- **Minors.** Groups working with under-18s are flagged, and their membership detail is kept
  inside the group record.
- **The welcome page knows nothing.** `/connect/<churchId>` shows the church's name and a form;
  it stores nothing about anyone else and shows no records.

### Roles

Administrators configure the church, manage accounts and read the audit trail. Pastors read and
write pastoral care. Follow-up coordinators run the visitor pipeline and assign work. Volunteers
see and work their own tasks. The server enforces every one of these on every request, and the
interface only hides what would be refused. Administrators deliberately do *not* get
pastoral-care access: configuring the system and reading people's care notes are different jobs.

---

## Figures you can trust

- Attendance is counted from attendance rows; nothing is stored as a total.
- Every rate carries its counts (`18 of 30 visitors returned · 60%`), and a zero denominator shows
  "No data yet" rather than a misleading 0%.
- Conversion rates all use one stated denominator: first-time visitors inside the chosen range.
- Thresholds are configurable and printed next to the figures they produce. "Flagged for review"
  means *no recorded attendance for N weeks*, shown with that reason — and nobody is reclassified
  automatically.
- The journey is a dated timeline, not a score. It describes what the church did and recorded; it
  says nothing about anybody's faith or commitment, and volunteer task counts are a measure of
  workload, never of anyone's worth.

---

## Testing

```bash
npm test          # the business rules, plus the server suites when TEST_DATABASE_URL is set
npm run test:db   # the server suites on their own
npm run e2e       # the Playwright suite: builds, then runs against Postgres and a stub Mailjet
```

The unit suites cover the business rules directly, with hand-built fixtures and an injected clock
and id factory: visitor registration and duplicate suggestion; task creation, assignment,
rescheduling and completion outcomes; automation idempotency and the rules that *stop* follow-up;
attendance recording, duplicate prevention and corrections; CSV import; membership conversion and
status history; pastoral care; the capability map; analytics denominators; message rendering,
consent refusals and search scoping. The deterministic synthetic church in `data/seed` exists for
these tests and nothing else.

The server suites run against a real Postgres: persistence and concurrency, authorisation and
scope, church selection, the audit trail, backup and restore, and the email pipeline — queueing,
concurrent workers, crash recovery, retry schedule, failure injection, bounce semantics, webhook
idempotency and the signed unsubscribe.

The end-to-end suite builds the production bundle and runs it against Postgres, a real Better
Auth session and a stub standing in for Mailjet's Send API. It needs `TEST_DATABASE_URL` (a
throwaway database: it creates and deletes churches and accounts) and `BETTER_AUTH_SECRET`, and
refuses to run against a database that is not on localhost.

---

## Known limitations

- **Account mail needs Mailjet.** Without it an invitation is still created and its link shown to
  copy, but changing an address is refused, since nothing could confirm the new one.
- **A church's only administrator cannot delete their account.** They must make somebody else an
  administrator first; there is no way yet to close a church altogether.
- **Email has not been through a real pilot.** Everything up to the provider is tested against
  a stub; the runbook's pilot step is what confirms the live account, the DNS and the webhook
  together, and the production gate stays shut until it has been done.
- **Vercel's Hobby plan runs crons daily at most.** The five-minute drain in `vercel.json` needs
  a paid plan there; the GitHub Actions workflow covers any host.
- **Backups and residency are the deployment's job.** The operator endpoint produces a backup;
  where it goes, how it is encrypted, how often it is taken and in which jurisdiction the
  database lives are decisions the application does not make.
- **Only member-or-visitor is historical.** Attendance counts somebody as a member from their
  membership date; the membership *status* tiles (active, inactive…) are today's counts.
- **Reminders go out once, at one hour, for everybody.** The schedule is in UTC and not per church
  or per person. On iPhone and iPad, Web Push only reaches a site added to the Home Screen, which
  GatherFlow does not yet offer (no web app manifest).
- **Accessibility** has been built in (labelled controls, keyboard-navigable forms, visible focus,
  tables that scroll inside their own container) but has not been through an assistive-technology
  audit.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui on Base UI ·
Zustand · React Hook Form + Zod · TanStack Table v9 · Recharts · Vitest · Playwright ·
Drizzle ORM on Postgres · Better Auth · Mailjet
