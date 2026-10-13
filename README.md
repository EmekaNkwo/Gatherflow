# GatherFlow

Church membership, first-time visitor follow-up and engagement — as an operations system
rather than a set of dashboard screens.

GatherFlow answers three questions on a busy Sunday: **who attended, who needs attention, and
what should the team do next?** A visitor is registered at the welcome desk, a volunteer is made
responsible for them, the welcome message gets drafted, the outcome of that conversation decides
what happens next, and their return visit, membership and group connection are all recorded
against the same person.

> **This is a frontend-only portfolio project.** There is no backend, no database and no real
> messaging. All data is synthetic, generated in the browser and stored in `localStorage`.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Vitest unit tests for the business rules |
| `npm run test:coverage` | Unit tests with coverage |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm run e2e` | Playwright end-to-end tests (builds first, then runs) |

The first page load in an empty browser generates a synthetic church: ~138 people, ten weeks of
attendance, a populated follow-up pipeline, groups, templates and care records. Everything after
that is your own activity, saved locally. **Settings → Demo data → Restore** puts it back.

The public visitor page lives at [`/connect`](http://localhost:3000/connect) and the guided
walkthrough at [`/demo`](http://localhost:3000/demo).

---

## Architecture

The rule that shapes the codebase: **UI components render and dispatch; they never contain
business rules.**

```
app/                     Routes only — composition, no logic
  (app)/                 The operations shell (sidebar, header, data provider)
  (public)/connect/      Visitor self-registration, deliberately outside the shell
components/              Presentation, grouped by feature
hooks/                   The API components use: useVisitors, useFollowUps, useAttendance, …
stores/                  Zustand: one snapshot, one commit path, one step of undo
services/                All business rules, as pure functions over a snapshot
  core/                  Command context, domain events, immutable snapshot helpers
  visitors/ follow-ups/ attendance/ members/ groups/ care/ communications/
  analytics/             Every figure, recounted from records
  automation/            The follow-up rule engine
  repositories/          Versioned, validated browser persistence
types/                   The domain model
data/seed/               Deterministic synthetic data
```

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
  `task.completed`). The store runs the automation engine once against those events.

The component layer stays thin:

```tsx
const { tasks, counts, complete, reschedule } = useFollowUps({ due: "today" });
```

### Automation that cannot misfire

Rules react to domain events, never to renders, and every generated task carries an
`automationKey` (`first_visit_welcome:<personId>:<date>`). Replaying an event can only produce a
duplicate-key refusal, so a re-render, a double click or an undo-and-redo cannot create a second
welcome task. Rules never emit events of their own, so one pass is always enough and no loop is
possible. Each rule can be turned off, retimed and reassigned in Settings.

Overdue work stores nothing at all: it is derived from due dates every time it is displayed, so
it cannot drift out of step.

### Persistence

`services/repositories` keeps a repository abstraction over a `StorageAdapter`, so the same code
runs against `localStorage` in the browser and an in-memory map in tests. Each collection is
stored under its own versioned key (`gatherflow:v1:people`) and validated with Zod on load.
Records that fail validation are dropped, reported in the interface, and the cleaned data is
written back — a hand-edited or half-written storage entry can never lock anybody out. Only the
collections whose array reference changed are rewritten on each command.

### Database (Postgres) — groundwork

> **The running application still uses `localStorage`.** The Postgres layer below is implemented
> and tested, but the UI is not wired to it yet; that is the next step.

`StorageAdapter` is synchronous by design, so a network database cannot sit behind it. The seam
for a database is one level up: `AsyncSnapshotRepository`, where the unit of work is a whole
snapshot and operations can be awaited. `server/db/snapshot-repository.ts` implements it with
Drizzle over Postgres, keeping the two properties that matter:

- **Validation on read.** Each record is stored whole in a `jsonb` column and parsed with the
  *same* Zod schema the browser uses. One malformed row is dropped and counted, never thrown.
- **Only what changed is written.** A commit compares array references and rewrites just those
  collections.

And adds what a shared database makes necessary:

- **Optimistic concurrency.** `churches.version` is the guard: a commit states the version it
  read, and one whose guard has been spent is refused with a `conflict` so the caller reloads
  rather than overwriting work it never saw.
- **Invariants enforced by the database.** Two rules the application previously held only in
  memory are now indexes, which is what makes them true across concurrent writers:
  `tasks_automation_key_unique` (the automation idempotency guarantee) and
  `attendance_session_person_unique`.
- **Deterministic ordering.** Loads are `ORDER BY id`; without it Postgres is free to reshuffle
  every list between reloads.

Alongside `data`, a small set of columns is *promoted* out of each record — those the database
needs to enforce an invariant or answer a query without loading the whole church. They are
derived from the record on write in one place, so they cannot disagree with it. This suits an
access pattern of "load one church" and is deliberately not a fully normalised schema; when
server-side filtering arrives, more columns get promoted and the records stay put.

```bash
cp .env.example .env.local        # then set DATABASE_URL

docker run -d --name gatherflow-pg \
  -e POSTGRES_USER=gatherflow -e POSTGRES_PASSWORD=gatherflow \
  -e POSTGRES_DB=gatherflow -p 5466:5432 postgres:17-alpine

npm run db:migrate                # apply migrations
npm run test:db                   # 13 integration tests against that database
```

| Command | What it does |
| --- | --- |
| `npm run db:generate` | Generate a migration from `server/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:studio` | Browse the database |
| `npm run test:db` | Integration tests (needs `TEST_DATABASE_URL`) |

The database tests skip themselves when `TEST_DATABASE_URL` is unset, so `npm test` stays green
on a machine with no Postgres. Point it at a throwaway database: the tests create and delete
churches.

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
- **Exports are minimal.** CSV exports exclude private notes; the JSON demo export excludes
  pastoral-care records and emergency contacts entirely.
- **Attendance stays personal.** Individual attendance history appears on the person's own record;
  shared dashboards only ever show counts.
- **Correction and deletion.** Records can be corrected, and deletion removes the person with all
  their attendance, tasks, messages and timeline. The audit entry left behind deliberately
  contains no personal details.
- **Minors.** Groups working with under-18s are flagged, and their membership detail is kept
  inside the group record.
- **Synthetic data only.** Every name is invented; phone numbers use Ofcom's reserved fictitious
  range; emails use `example.com`.

### Demo roles are not security

The role switcher changes what the interface offers: a volunteer sees only their own tasks, a
member sees no directory, pastoral care is visible to pastors. **These checks run in the browser
and anyone can change them.** They demonstrate role-aware UI, nothing more. A real deployment must
enforce every one of them on a server. Administrators deliberately do *not* get pastoral-care
access: configuring the system and reading people's care notes are different jobs.

### Simulated messaging

GatherFlow never sends anything. It drafts a message, copies it to your clipboard, or hands it to
an app you already have (`wa.me`, `sms:`, `mailto:`), always on an explicit click. The
communication log records exactly which of those happened — *drafted*, *copied*, *opened
externally* or *simulated send*. There is no "delivered" status, because the application cannot
verify delivery and should not claim it.

---

## Figures you can trust

- Attendance is counted from attendance rows; nothing is stored as a total.
- Every rate carries its counts (`18 of 30 visitors returned · 60%`), and a zero denominator shows
  "No data yet" rather than a misleading 0%.
- Conversion rates all use one stated denominator: first-time visitors inside the chosen range.
- The seed generator is deterministic, so reloading never changes a reported number.
- Thresholds are configurable and printed next to the figures they produce. "Flagged for review"
  means *no recorded attendance for N weeks*, shown with that reason — and nobody is reclassified
  automatically.
- The journey is a dated timeline, not a score. It describes what the church did and recorded; it
  says nothing about anybody's faith or commitment, and volunteer task counts are a measure of
  workload, never of anyone's worth.

---

## Testing

```bash
npm test        # 124 unit tests (+13 database tests when TEST_DATABASE_URL is set)
npm run test:db # the 13 database integration tests on their own
npm run e2e     # 13 end-to-end tests
```

Unit tests cover the business rules directly, with hand-built fixtures and an injected clock and
id factory: visitor registration and duplicate suggestion; task creation, assignment,
rescheduling and completion outcomes; automation idempotency and the rules that *stop* follow-up;
attendance recording, duplicate prevention and corrections; CSV import; membership conversion and
status history; analytics denominators; persistence, recovery from invalid data, reset, export
and import; message rendering, consent refusals and search scoping.

The end-to-end tests walk the real journeys in a browser — registration through to membership and
a connect group, a returning visit, opt-out handling, role scoping, persistence across reloads,
recovery from corrupted storage, the public welcome page, and mobile layout.

---

## Known limitations

- **No backend yet.** No authentication, no multi-user sync, no audit trail outside the browser;
  clearing site data deletes everything. The Postgres persistence layer is written and tested but
  not yet wired to the interface, and authorization is still browser-side only.
- **One browser, one church.** Data does not follow the user between devices.
- **Membership state is not historical.** Attendance charts group people by what they are *now*,
  which the reports say on the page.
- **Browser storage limits.** The seed is roughly 700 KB of JSON. A real church with years of
  attendance would need IndexedDB — the repository abstraction is where that would go.
- **Notifications** only work while the tab is open and only with permission. The dashboard
  always shows reminders regardless.
- **Accessibility** has been built in (labelled controls, keyboard-navigable forms, visible focus,
  tables that scroll inside their own container) but has not been through an assistive-technology
  audit.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui on Base UI ·
Zustand · React Hook Form + Zod · TanStack Table v9 · Recharts · Vitest · Playwright ·
Drizzle ORM on Postgres (persistence groundwork; see [Database](#database-postgres--groundwork)).
