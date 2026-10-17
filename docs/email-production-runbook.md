# Email production runbook

What has to be true before `EMAIL_SENDING_ENABLED=true` is set on a deployment,
in the order to do it. Each step says what to check and where the evidence is.

The gate exists because credentials alone make sending *possible*; this list is
what makes it *responsible*. Until it is done the interface drafts, copies and
hands messages to other apps; it never sends.

## 0. What is already verified without an account

These are covered by the test suites and do not need repeating per deployment:

| Property | Where it is asserted |
| --- | --- |
| Record and queue row commit together or not at all | `server/email/email.test.ts` |
| Consent, address and suppression checked before queueing | `email.test.ts`, `hardening.test.ts` |
| Several workers never send a row twice (`FOR UPDATE SKIP LOCKED`) | `hardening.test.ts` → worker concurrency |
| A dead worker's claim is reclaimed; a live one's is not | `hardening.test.ts` → crash recovery |
| 5xx/429/dropped connection retry with doubling backoff, capped, then stop | `hardening.test.ts` → retry schedule |
| One bad message does not block the batch | `hardening.test.ts` → failure injection |
| Hard bounce, spam, unsubscribe and `preblocked` suppress and opt out; soft bounces and content/system blocks do not | `hardening.test.ts` → bounces |
| Webhook events are idempotent; a forged event changes nothing | `email.test.ts` → provider events |
| Unsubscribe links are signed; one-click POST works; repeat is a no-op | `hardening.test.ts`, `e2e-remote/` |
| Suppression and the pilot allowlist are re-checked at send time, not only at queue time | `hardening.test.ts` → unsubscribe |
| Statuses move forward only; a late `sent` cannot undo a `bounced` | `hardening.test.ts` → status ordering |
| 200 sends per church per hour; one send per person per 10 minutes | `hardening.test.ts` → what gets sent |
| The whole path over HTTP: sign in → compose → drain → webhook → unsubscribe | `npm run e2e:remote` |

## 1. Mailjet account

1. Create the account and an **API key pair** (Account settings → API keys).
   Put them in `MAILJET_API_KEY` / `MAILJET_SECRET_KEY`.
2. Note the account's **daily sending limit** on a new account (Mailjet raises
   it after a sending history exists). The pilot must stay under it.
3. Enable **Group events** on the webhook (Account settings → Event tracking)
   — or set the callback's `version` to 2 through the API. The handler accepts
   both a single event and an array, but grouping halves the request count.

## 2. Sender and domain

1. **Add the sending domain** (Senders & Domains → Add a domain) and complete
   the ownership check (a TXT record or a hosted file).
2. **Add the sender address** used in `MAILJET_FROM_EMAIL` and confirm it.
3. Publish the three DNS records below, then run:

   ```bash
   npm run email:check-dns -- yourchurch.example
   ```

   | Record | Name | Value |
   | --- | --- | --- |
   | SPF | `yourchurch.example` | `v=spf1 include:spf.mailjet.com ~all` (merge into an existing SPF record; there must be exactly one) |
   | DKIM | `mailjet._domainkey.yourchurch.example` | the `k=rsa; p=…` value Mailjet shows for the domain |
   | DMARC | `_dmarc.yourchurch.example` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourchurch.example` |

   Start DMARC at `p=none` only if the domain already sends mail from elsewhere
   and the reports need reading first; move to `quarantine` or `reject` once
   they are clean. The script warns on `p=none`.
4. Back in Mailjet, the domain must show **SPF: validated** and **DKIM:
   validated**. The script checks that records exist and are well formed; only
   Mailjet can confirm the DKIM key it signs with is the one published.

## 3. Webhook

1. Generate the secret and set `MAILJET_WEBHOOK_SECRET`:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. In Mailjet (Account settings → Event tracking) set the callback URL for
   `sent`, `bounce`, `blocked`, `spam` and `unsub` to:

   ```
   https://<host>/api/webhooks/mailjet/<MAILJET_WEBHOOK_SECRET>
   ```

   Leave `open` and `click` unset. The handler discards them, but not
   subscribing means Mailjet does not insert tracking pixels or rewrite links.
3. Verify with a hand-made request; both must be true:

   ```bash
   # wrong secret → 404, nothing recorded
   curl -i -XPOST https://<host>/api/webhooks/mailjet/wrong -d '[{"event":"sent"}]'
   # right secret, unknown message → 200 with applied:0 ignored:1
   curl -i -XPOST https://<host>/api/webhooks/mailjet/$MAILJET_WEBHOOK_SECRET \
     -H 'content-type: application/json' -d '[{"event":"sent","CustomID":"x:y","time":1}]'
   ```

   Every delivery is kept in `webhook_inbox` with its outcome, so the second
   request should appear there with `events=1, ignored=1`.

## 4. Cron and monitoring

1. Set `CRON_SECRET` and schedule the drain every 1–5 minutes, whichever way the host offers:

   | Host | How |
   | --- | --- |
   | Vercel | `vercel.json` already declares a five-minute cron; Vercel sends the bearer itself. The Hobby plan allows daily crons only — change the schedule or use the GitHub workflow there. |
   | GitHub Actions | `.github/workflows/drain-outbox.yml` runs once `DRAIN_URL` and `CRON_SECRET` repository secrets are set. |
   | Render / Fly / anything with a cron job | `curl -XPOST -H "authorization: Bearer $CRON_SECRET" https://<host>/api/cron/drain-outbox` |

   `GET` and `POST` both work. Each pass sends at most 25 rows; a backlog drains over several
   passes. `CRON_SECRET` is also the operator secret for the health check and for backup and
   restore, so treat it accordingly.
2. Point an uptime monitor at the health endpoint with the same bearer:

   ```bash
   curl -H "authorization: Bearer $CRON_SECRET" https://<host>/api/email/health
   ```

   It answers `503` when the oldest *due* message has waited more than 15
   minutes unclaimed (rows waiting out a retry backoff do not count), when any
   message has given up, or when a webhook delivery in the last 24 hours could
   not be processed; `200` otherwise. Alert on the status code. The cron pass
   also prunes `webhook_inbox` rows older than 30 days.
3. Logs: the server writes one JSON line per event — `email.queued`,
   `email.drain`, `email.webhook`, `email.webhook.failed`,
   `email.unsubscribe` — so a log search can graph the queue. Nothing in them
   is a message body or an address.

## 5. Unsubscribe

1. Set `UNSUBSCRIBE_SECRET` (or rely on `BETTER_AUTH_SECRET`; a dedicated one
   means rotating the auth secret does not break links already in inboxes).
2. `BETTER_AUTH_URL` must be the public origin: it is what the link is built
   from.
3. Open `https://<host>/unsubscribe?church=x&person=y&token=z` — it must say
   the link is not valid, not 500.

## 6. Controlled pilot

1. Set `EMAIL_SENDING_ENABLED=true` **and** `EMAIL_PILOT_ALLOWLIST` to the
   team's own addresses, comma-separated. Every other recipient is refused
   before anything is queued, and the composer says a pilot is in force.
2. Register each pilot address as a visitor with contact permission, then from
   their record: *Prepare a message* → channel *Email* → *Send email*.
   Expect the toast "Email queued" and the record to show *Queued to send*.
3. After the next cron pass the record shows *Sent to the provider*; after
   Mailjet's `sent` event, *Delivered to their mail server*. Check the message
   in the inbox: `From` name and address, subject, the plain-text and HTML
   parts, and that the mail client shows an unsubscribe option (the
   `List-Unsubscribe` header).
4. Use the unsubscribe link from one pilot message. The record must show *Do
   not contact*, open follow-up work must be cancelled, and a further send to
   that person must be refused with the suppression message.
5. Send to a deliberately dead address on your own domain (e.g.
   `nobody-<random>@yourchurch.example`). Expect a `bounce` with
   `hard_bounce: true` within minutes, then the record *Bounced* and *Do not
   contact*. This is the only way to confirm the webhook secret, the event
   shape and the opt-out path together against the real provider.
6. Check `/api/email/health` reads `200` with `failed: 0`.
7. Remove the pilot addresses from the allowlist; clear `EMAIL_PILOT_ALLOWLIST`
   to end the pilot.

## 7. Things only the real account can confirm

Verified from Mailjet's documentation, to be re-checked once against the live
account during the pilot:

- **Event payload** fields used by the handler: `event`, `time`, `MessageID`,
  `Message_GUID`, `email`, `CustomID`; on `bounce` additionally `hard_bounce`,
  `blocked`, `error_related_to`, `error`, `comment`; on `blocked`
  `error_related_to`, `error`. The `webhook_inbox` table keeps the raw bodies,
  so a mismatch shows up there.
- **`CustomID`**: Mailjet documents it as a free-form string with no stated
  maximum length. Ours is `<churchId>:<outboxId>` — around 60 characters.
  During the pilot, confirm the webhook echoes it back unchanged (the
  `webhook_events` row is only written when it matched a row).
- **Retry behaviour**: Mailjet retries a non-200 every 30 seconds for 24
  hours. The handler returns 500 only after writing the delivery to the inbox,
  and — when the opt-out that follows a bounce or complaint could not be
  committed — after forgetting the event, so the retry applies it again.
- **Daily limit** on a new account, and whether the account is still in
  Mailjet's review period.

## Backup and restore

Before the pilot, and on a schedule afterwards:

```bash
CRON_SECRET=… node scripts/church-backup.mjs backup  https://<host> <churchId>            # writes gatherflow-<id>-<time>.json
CRON_SECRET=… node scripts/church-backup.mjs restore https://<host> <churchId> <file>     # puts it back
```

The file holds everything, pastoral care included: encrypt it at rest and delete it when it is
no longer needed. A restore is refused if the file is not whole, or if it is of a different
church (add `--allow-different-church` to clone on purpose). Both actions appear in the audit
trail.

## Rollback

Set `EMAIL_SENDING_ENABLED=false` and redeploy. Nothing new is queued; what is
already queued still drains (the cron is deliberately not gated), and the
webhook keeps applying reports to messages already sent.
