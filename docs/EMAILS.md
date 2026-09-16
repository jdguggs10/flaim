# Email Brand System

Flaim uses a small, restrained email system so product emails, auth emails, and support replies feel like the same product without forcing every provider through one sending service.

## Provider roles

| Provider | Role | Sender |
| --- | --- | --- |
| Fastmail | Real inboxes, aliases, and replies | `support@flaim.app` |
| Clerk | Authentication and security emails | `Flaim <accounts@flaim.app>` |
| Resend | Product and lifecycle emails | `Flaim <updates@flaim.app>` |
| Resend | Broadcasts | `Flaim <updates@news.flaim.app>` |

Use `support@flaim.app` as the reply-to address for product email.

Resend uses separate verified US East sending domains for the two lanes:

- `flaim.app` carries product and lifecycle email. Open and click tracking are off; Flaim-owned links use first-party `ref=` attribution instead.
- `news.flaim.app` carries Broadcasts. Open tracking is off and click tracking is on through `links.news.flaim.app`.

The `send.flaim.app` and `send.news.flaim.app` DNS records are Resend bounce / MAIL FROM infrastructure, not visible From addresses.

Root DMARC stays at `p=quarantine`. Aggregate reports go to Cloudflare DMARC Management only: `postmaster@flaim.app` was dropped from the `rua` tag on 2026-09-12, once the mailbox move gave that alias a real destination and the daily XML reports began arriving in the support inbox. Read them in the Cloudflare dashboard under Email > DMARC Management, not by mail. DMARC policy is discovered from the visible From domain. Product and Clerk mail send as `flaim.app`, so the root record governs them directly. Only the Broadcast lane uses a From subdomain, `news.flaim.app`, and it publishes no `_dmarc` record of its own, so it falls back to the root policy. The `send.` and `clkmail.` subdomains are MAIL FROM and SPF authentication domains that never appear in a visible From, so a `_dmarc` record on any of them would have no effect.

Moving to `p=reject` stays a provider-level decision, not a template change, and the templates are not what blocks it. DMARC passes when either aligned SPF or aligned DKIM passes, so `p=reject` changes the outcome only for mail that fails both. Before tightening the policy, confirm from current aggregate reports that every sending lane passes on aligned DKIM rather than on aligned SPF alone. SPF alignment is the half that breaks when a message is forwarded, so a lane leaning on it has no second mechanism left at that point. Check a window that includes a Broadcast send.

## Visual rules

- Keep emails quiet and utilitarian: white card, light gray page background, one primary action.
- Mirror the website tokens in `web/app/globals.css`, but use email-safe hex values in `web/emails/brand.ts`.
- Use shared colors, type, button styling, support footer, and plain-language copy across providers.
- Resend product emails use the optimized transparent Flaim mark at 36px in the card's top-right corner, aligned with the eyebrow on the left or with the title when no eyebrow is used. The shared layout does not add a separate text wordmark above the card.
- Clerk auth emails use the dashboard application logo at 72px with the `FLAIM FANTASY` label. Keep this provider-specific because Clerk/Revolvapp controls the final email HTML.
- Use system fonts, 8px containers, 6px buttons, and plain-language copy.
- Shared Resend cards use 20px top padding and 28px side/bottom padding. Callout body text uses the foreground color for readability against the muted box.
- Do not add promotional hero art to auth or security emails.
- Product and lifecycle emails must include a clear unsubscribe or notification-preferences link in the footer before they are connected to a live sender.

## Resend templates

Templates live in `web/emails`.

Run the local preview server:

```sh
corepack pnpm --dir web run email:dev
```

Use this browser preview as the visual editing surface. It refreshes while the
React Email template changes, so copy length, spacing, hierarchy, and mobile
layout can be judged before anything is created in Resend.

Export static HTML previews:

```sh
corepack pnpm --dir web run email:export
```

This writes ignored preview HTML to `web/.email-out/`.

### Broadcast workflow

Broadcasts are repo-authored and provider-sent. Follow this order:

1. Add or update the React Email template. `web/emails/brand.ts` is the shared source of truth for the product From and reply-to values.
2. Run `corepack pnpm --dir web run email:dev` for local iteration.
3. Run `corepack pnpm --dir web run email:export`. It writes the ignored HTML export and plain-text fallback to `web/.email-out/`.
4. Create exactly one provider draft from those exports. Before this step, manually obtain the intended Resend **Segment** ID from the dashboard and load a dedicated full-access broadcast credential into `RESEND_BROADCASTS_API_KEY` from Flaim's password manager (currently 1Password) without printing it. An audience ID is not a segment ID; never substitute one for the other. Do not source this credential from `web/.env.local`: that file's `RESEND_API_KEY` is deliberately sending-only and cannot create broadcasts.

   ```sh
   # From the repository root. Nothing here prints either credential.
   (
     unset RESEND_API_KEY
     : "${RESEND_BROADCASTS_API_KEY:?Load the full-access broadcast key from Flaim's password manager first}"
     RESEND_BROADCAST_SEGMENT_ID="...manually verified Segment ID..."

     RESEND_API_KEY="$RESEND_BROADCASTS_API_KEY" corepack pnpm --dir web dlx resend-cli@2.14.0 broadcasts create \
       --from "Flaim <updates@news.flaim.app>" \
       --reply-to support@flaim.app \
       --subject "Keepers, draft details, and more" \
       --preview-text "Keeper costs, dynasty draft picks, and sharper trade detail for your connected leagues." \
       --name "Football kickoff: keepers + Yahoo" \
       --segment-id "${RESEND_BROADCAST_SEGMENT_ID:?Set a manually verified Resend Segment ID first}" \
       --html-file .email-out/broadcast-2026-08-kickoff.html \
       --text-file .email-out/broadcast-2026-08-kickoff.txt
   )
   unset RESEND_BROADCASTS_API_KEY
   ```

   The subshell first clears any ambient `RESEND_API_KEY`, then passes the dedicated broadcast credential only to the downloaded CLI under the variable name it expects. The segment ID exists only inside the subshell and is passed as an argument. The final `unset` clears the operator-supplied broadcast credential from the outer shell. Never echo, copy, or commit either value. The command contains no `--send` or `--scheduled-at`, so the CLI creates a draft only. Do not run it with an empty or unverified segment value.
5. Use the Resend dashboard only to confirm the Segment, select the appropriate durable Topic, send proof emails, and send after review. Topics describe the kind of email and preserve a recipient's subscription preference; Segments describe who should receive a particular Broadcast. Provider-availability messages use the public `Service updates` Topic. Keep one-off cohorts such as the Yahoo access-update audience as campaign-specific Segments rather than creating provider-specific Topics. Do not edit email content in the dashboard: Resend's editor lock prevents reliable code-side revision after a dashboard edit, so content changes require a new repo export and draft.
6. Comment every real test or audience send on its Linear issue with the draft ID, audience, proof result, and final send state.

Do not send a real email while developing this workflow. The local `RESEND_API_KEY` is sending-only and restricted to `flaim.app`; it must never be broadened for broadcast work. Keep full-access operator credentials out of `.env.local`, and do not change provider keys or feature flags as part of routine copy iteration. Load the broadcast credential per use because its pinned first-party CLI consumer can create and modify provider resources. Load the suppression credential per use as well: the reconciliation script has no write mode, but the raw credential still has Full access outside that script.

The official [`resend-cli` v2 broadcast reference](https://github.com/resend/resend-cli/blob/main/skills/resend-cli/references/broadcasts.md) supports `--html-file`, `--text-file`, `--name`, `--reply-to`, and `--preview-text`, and saves a draft unless `--send` is supplied. It targets the current API's required `segment_id` contract and maps the CLI reply-to input to the API's `reply_to` array. The pinned CLI command above therefore replaces a custom draft creator.

The first product templates are:

- `web/emails/welcome.tsx`
- `web/emails/broadcast-2026-08-kickoff.tsx`
- `web/emails/broadcast-2026-08-yahoo-access.tsx`
- `web/emails/broadcast-2026-09-update.tsx`
- `web/emails/broadcast-2026-09-yahoo-back.tsx`
- `web/emails/espn-setup-link.tsx`

Template URL samples exist in `PreviewProps` for local preview only. Production senders must pass app URLs, action URLs, and unsubscribe/preference URLs explicitly from the send call so preview values do not leak into staging or production messages by accident.

### Yahoo operational Broadcast Segment

`web/scripts/prepare-yahoo-broadcast-segment.mjs` prepares the one-off Yahoo
access-update Segment. It is campaign-specific rather than a durable platform
property sync. Every selected user must have a current Yahoo credential. Among
those users, the default cohort includes credentials created on or after
`2026-07-27T18:15:36Z` or users with a stored 2026 Yahoo league. Users in
`analytics.internal_users` are excluded by SHA-256 hash before Clerk or Resend
eligibility is evaluated.

The script requires production `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and
`CLERK_SECRET_KEY`; an operator-only Full access Resend credential loaded into
`RESEND_BROADCASTS_API_KEY`; and the current internal-user hashes in
`FLAIM_INTERNAL_USER_HASHES`. Load credentials per command from the password
manager without printing them, and unset them afterward. Do not store them in
`.env.local`. Hash each exact Clerk user ID as UTF-8 with SHA-256, without a
trailing newline, and pass the lowercase hex digests as a comma-separated list.

The default command is read-only and prints aggregate counts only:

```sh
corepack pnpm --dir web exec node scripts/prepare-yahoo-broadcast-segment.mjs
```

After reviewing that count, manually create an empty, campaign-specific Resend
Segment. Apply mode requires its exact ID and name plus the reviewed eligible
count:

```sh
corepack pnpm --dir web exec node scripts/prepare-yahoo-broadcast-segment.mjs \
  --apply \
  --segment-id "..." \
  --segment-name "Yahoo access update - 2026-08" \
  --expected-eligible-count "..."
```

Apply mode verifies that any existing Segment members belong to the current
eligible cohort, refreshes Resend contact and suppression state immediately
before its first write, adds only missing eligible contacts, then refreshes
eligibility and re-reads the Segment again to prove the final membership. Any
count or membership drift fails closed. If any Segment write is attempted and
population or final verification fails, do not use that Segment: create a new
empty campaign Segment, review a fresh dry run, and retry. It never creates
contacts, changes an unsubscribe state, removes a suppression, creates a
Broadcast, or sends email.

Run one final read-only dry run immediately before creating the provider draft
or sending. Segment membership is not a substitute for current unsubscribe and
suppression checks, and any changed count requires renewed review.

## Link attribution

Every `flaim.app` link in an outbound email must carry a `ref` query param naming the campaign (`ref=email-<campaign>`, lowercase/digits/hyphens). This is what makes post-send activity attributable instead of timing-guessed.

- **Code-sent email** (transactional templates, API-created broadcasts): build the URL with `withEmailRef(url, 'email-<campaign>')` from `web/emails/link-ref.ts` at the send call.
- **Dashboard-composed Resend broadcasts**: the helper can't run there — add `?ref=email-<campaign>` to each `flaim.app` link by hand before sending. Treat this as part of the pre-send checklist, alongside the unsubscribe link.
- Do not tag external links (Chrome Web Store, ChatGPT app listing); only Flaim-owned URLs read the param.

Readout: `/leagues` reports a `leagues_page_view` setup signal (with the `ref` value and device class) whenever a signed-in visitor arrives via a tagged link, and includes `ref` on `espn_connect_ui_view`. Query these in the auth-worker's Workers Logs, filtered by `event` and faceted by `ref`.

`@react-email/render`, `resend`, and `server-only` are production dependencies because the server send helper renders and sends these templates. `react-email` and `@react-email/ui` remain dev-only preview dependencies; do not remove `@react-email/ui` just because templates do not import it directly.

This package includes a server-only Resend send helper. Product email sending stays disabled unless `FLAIM_EMAILS_ENABLED=true` is set. Transactional messages need an explicit reviewed trigger and idempotency policy; marketing messages additionally need a real unsubscribe mechanism.

Clerk is the source of truth for user identity. Resend delivers product email but is not the canonical CRM. The Clerk webhook at `web/app/api/webhooks/clerk/route.ts` supports one mutually exclusive signup-welcome mode:

- `automation`: emit the custom Resend event `flaim.user_created`; the hosted automation creates the contact, adds it to the Segment, and sends the welcome.
- `direct`: call the send-only Resend email API with the React welcome template and the stable idempotency key `welcome/<clerk-user-id>`; no Resend contact or Segment membership is created.
- `disabled`: record the signup but do not queue welcome delivery.

`FLAIM_WELCOME_DELIVERY_MODE` selects `automation`, `direct`, or `disabled`. While it is unset, the legacy `RESEND_WELCOME_AUTOMATION_ENABLED=true` flag maps to `automation`; any other legacy value maps to `disabled`. This preserves existing production behavior through the backward-compatible deployment. An invalid explicit mode fails closed as disabled.

`user.updated` can lightly repair a Resend contact only when `RESEND_CONTACT_SYNC_ENABLED=true` and the welcome mode is not `direct`. Direct mode fails the legacy repair path closed even if that old flag is accidentally left true, so an email update cannot restart Resend audience growth.

Plunk marketing-contact ownership is a separate, default-off path selected by `PLUNK_MARKETING_SYNC_ENABLED=true`. Only verified Clerk `user.created` events enter it; `user.updated` never does. The server calls Plunk's atomic `/v1/track` endpoint with `PLUNK_PUBLIC_API_KEY`, persistent identity metadata, and no `subscribed` field. Plunk therefore creates a new contact subscribed by default but preserves an existing contact's current state, including an opt-out. A stable Clerk-user idempotency key contains webhook replays within Plunk's 24-hour window; later replays may record another inert event but still cannot change subscription state. Do not attach a sending workflow to the `flaim.user_created` sync event.

The handler verifies Clerk's webhook signature with `CLERK_WEBHOOK_SIGNING_SECRET` and acknowledges verified Clerk events even if downstream email-provider work fails, so provider outages do not create Clerk webhook retry storms.

## Delivery operations and recovery

Email operations emit compact JSON records to Vercel structured logs. The stable
event names are `email.welcome_event_failed`, `email.welcome_event_skipped`,
`email.contact_sync_failed`, `email.send_failed`, `email.bounced`,
`email.complained`, `email.failed`, and `email.delivery_delayed`. Webhook
verification failures use `email.webhook_verification_failed`. These records
include provider-safe IDs and failure categories but never recipient addresses,
raw webhook bodies, signatures, or API keys.

When a Resend welcome delivery, Resend contact sync, or Plunk contact sync fails after a verified Clerk webhook,
Flaim stores the matching retry marker in that user's Clerk private metadata at
`flaim_email_ops.welcomeEvent`, `flaim_email_ops.contactSync`, or
`flaim_email_ops.plunkContactSync`. Clerk's metadata
write is a deep merge, so unrelated private metadata is retained. A retry marker
is never refreshed when it already exists, which prevents marker-caused
`user.updated` webhooks from looping during an outage. Each successful operation
clears only its own marker; it cannot clear a failure from another lane.

The Plunk sync runs in its own `after()` callback and never changes the webhook response or welcome result. Provider failures are acknowledged to Clerk, logged as `email.contact_sync_failed` with `provider: "plunk"`, and leave the durable Plunk retry marker for reconciliation. Flag-off and unusable-email skips do not create retry debt. The Plunk marker is deliberately passive in this phase: `backfill-resend-contacts.mjs` does not consume it, and no background retry worker is being introduced. Treat it as durable operator evidence, reconcile the affected current Clerk user through the Plunk migration command, confirm the contact exists with the intended subscription state, and only then clear that marker in Clerk. This avoids coupling the retired Resend repair lane to Plunk or creating a second automatic writer during migration. The production feature flag remains off until the server key is deployed and a separately approved internal proof has passed.

Historical ownership moves through `web/scripts/migrate-marketing-contacts-to-plunk.mjs`. It is dry-run by default and requires the Resend all-status contact export, live Clerk users, live Resend suppressions, and current Plunk contacts. The candidate set is their normalized union: this captures Clerk users created after Resend contact growth stopped while retaining Resend-only records under the existing account-deletion policy. Clerk is read through a frozen, ascending, count-checked snapshot so live signup growth cannot shift offset pages. Resend unsubscribe, Resend suppression, and existing false Plunk state always beat a subscribed candidate. The apply pass writes false targets first through the secret contacts API, then sends true targets through `/v1/track` without a subscription override, which atomically creates new contacts subscribed while preserving any false state established concurrently. It honors `Retry-After`, stores only email hashes in its required resumable state file, then re-reads Plunk and a fresh frozen Clerk snapshot. An interrupted run may resume across additive live signups only when every previously completed target is still present with the same subscription state; a changed or removed completed target fails closed and requires operator review. Missing current Clerk contacts or unsafe final states also fail the run. Keep the source CSV and state file outside git.

```sh
# Read-only planning and exact count reconciliation.
corepack pnpm --dir web exec node scripts/migrate-marketing-contacts-to-plunk.mjs \
  --resend-contacts /path/outside-repo/resend-contacts.csv

# Separately approved write pass, resumable from a private state file.
corepack pnpm --dir web exec node scripts/migrate-marketing-contacts-to-plunk.mjs \
  --resend-contacts /path/outside-repo/resend-contacts.csv \
  --apply \
  --state-file /path/outside-repo/plunk-migration-state.json
```

The command requires `CLERK_SECRET_KEY`, `RESEND_SUPPRESSIONS_API_KEY`, `PLUNK_SECRET_API_KEY`, and `PLUNK_PUBLIC_API_KEY`. The broad Plunk secret belongs in the operator shell for this command only, not in Vercel. Do not apply from an old dry-run: refresh the Clerk and suppression reads, use the same reviewed Resend export, and confirm the printed Clerk-only gap and false-state counts immediately before the write gate. Keep Plunk campaign and workflow sending disabled throughout the import.

The marker bounds webhook retry loops; it is not an exactly-once delivery
guarantee. In automation mode, the flagged recovery command can conservatively
use Resend contact existence as evidence that the prior event landed. In direct
mode, contact existence says nothing about the send. The direct path instead
uses Resend's email idempotency key `welcome/<clerk-user-id>`. Legacy contact and
event recovery write modes refuse to run while direct mode is selected.

Direct `resend.emails.send` calls may pass a caller-supplied SDK
`idempotencyKey` only for a genuinely one-time business event with a stable
semantic identifier. The one-time welcome uses the immutable Clerk user id;
repeatable requests such as an ESPN setup-link resend omit the option so Resend
does not replay-cache a legitimate later request. Resend supports that
provider-side idempotency option for email endpoints, but not for `events.send`.

### Resend delivery-feedback webhook

`POST /api/webhooks/resend` verifies `svix-id`, `svix-timestamp`, and
`svix-signature` against the exact raw request text with
`RESEND_WEBHOOK_SIGNING_SECRET`. Do not parse and stringify the body before
verification because even whitespace changes invalidate the signature. The route
records `email.bounced`, `email.complained`, `email.failed`, and
`email.delivery_delayed`; delivery feedback is logged only and does not mutate
Clerk users or Resend suppressions.

Webhook setup requirements:

1. Create a Resend webhook for `https://flaim.app/api/webhooks/resend` that sends
   `email.bounced`, `email.complained`, `email.failed`, and
   `email.delivery_delayed`.
2. Set that endpoint's signing secret as `RESEND_WEBHOOK_SIGNING_SECRET` in the
   Vercel environment before enabling the webhook.
3. Send an intentional test through the configured Resend workflow and confirm a
   structured delivery event in Vercel logs. Do not use a production recipient
   without approval.

The maintenance contact sync stores only email, first name, and last name. It updates first and creates only if Resend reports the contact is missing, avoiding a separate contact-existence preflight. It intentionally does not resubscribe existing contacts during updates, so Resend unsubscribe state remains authoritative for product and broadcast email. If `RESEND_CONTACT_SEGMENT_ID` is set, repaired contacts are assigned to that Resend Segment for future Broadcast targeting. Avoid writing custom Resend contact properties unless those properties have first been created in Resend.

The welcome email is transactional onboarding sent once after account creation. In direct mode, Flaim renders `web/emails/welcome.tsx` and sends it through the send-only Resend API. The direct version contains no unsubscribe link; optional product-update Broadcasts own marketing unsubscribe separately. It does not create a Resend contact.

The hosted Resend Automation remains a rollback lane during migration. In automation mode, the verified Clerk webhook emits `flaim.user_created` with the user's email plus non-name metadata (`clerk_user_id`, `source`). Resend creates a missing contact, adds it to the configured Segment, sends the templated welcome, and records the automation run. The event emitter uses `RESEND_EVENTS_API_KEY` when set, otherwise it falls back to `RESEND_CONTACTS_API_KEY`; do not use the send-only `RESEND_API_KEY` for event/automation management.

The production cutover is deliberately one switch, not two independent welcome flags:

1. Deploy code with `FLAIM_WELCOME_DELIVERY_MODE` unset. The existing legacy automation flag continues to select today's behavior.
2. Confirm `FLAIM_EMAILS_ENABLED=true`, the send-only `RESEND_API_KEY` is present, and `RESEND_CONTACT_SYNC_ENABLED=false`.
3. Set `FLAIM_WELCOME_DELIVERY_MODE=direct`. From that point each new webhook selects only the direct branch; it cannot also emit the automation event.
4. Canary one fresh signup. Require one welcome in the inbox, no new Resend Audience contact, a cleared retry marker, and the expected structured logs.
5. Keep the hosted automation available but event-idle for rollback. To roll back, set the single mode to `automation`; do not run two modes together.

The Clerk webhook intentionally acknowledges verified user events even if downstream Resend work fails, so a Resend outage does not create Clerk webhook retry storms. Confirm failed direct welcome sends are visible through the existing structured log and retry-marker path before the production switch.

Direct mode also writes a retry marker when application email is globally disabled or the transactional API key is unavailable. This is intentional: signups during a rollout-order mistake remain identifiable for recovery instead of being silently lost.

Create or refresh the Resend-side resources with:

```sh
corepack pnpm --dir web exec tsx scripts/setup-resend-welcome-automation.mjs
```

The setup script creates the `flaim.user_created` event, publishes the `flaim-welcome-v1` template, and creates/updates the `Flaim Welcome Email` automation as `disabled`. It requires `RESEND_CONTACT_SEGMENT_ID` (the `Flaim Users` segment id, visible in the Resend Audience → Segments URL) because the automation chain is `trigger -> add_to_segment -> send_email`. **Resend rejects API edits to an enabled automation** ("This automation is enabled and cannot be edited"), so the working order is: disable the automation in the Resend dashboard, run the script (it republishes the template and updates the automation, leaving it disabled), send a real test email, then re-enable it. The script's event and template steps run before the automation step, so if it fails on an enabled automation the template has already been republished; disable and re-run. Verified 2026-08-16. The signup automation does not enrich contact names; that remains the responsibility of the `user.updated` repair path and the backfill script. Re-running the script intentionally disables the automation again as a safety guard while templates are being revised. Enable the automation in Resend only after the production webhook event path has been tested.

The setup script refuses to run when `FLAIM_WELCOME_DELIVERY_MODE=direct`. The contact backfill and quota-incident recovery commands remain usable for read-only inspection, but their write modes also fail closed in direct mode. This prevents an old runbook command from silently restarting Resend contact growth after cutover.

The Resend automation setup script renders `web/emails/welcome.tsx` directly with `@react-email/render`, so the React template is the single source for both automation HTML and plain text. Shared action URLs live in `web/emails/flaim-email-links.json`. When changing the welcome email, update the React template, run `corepack pnpm --dir web run email:export`, rerun the setup script, and send a real test email before enabling or re-enabling the automation.

Existing users are backfilled or repaired with a separate dry-run-first script. This is not part of the normal signup welcome path. Run it from the repo root:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs
```

The script requires `CLERK_SECRET_KEY` for dry-runs and `RESEND_CONTACTS_API_KEY`
when applying contact changes or normal flagged welcome recovery: the latter reads
the contact before it can safely retry the event. `RESEND_API_KEY` should remain the
send-only email key; the contact sync key needs Resend Contacts and Segments
permissions. The script skips users without a primary email and users whose
primary email is explicitly unverified. When applying writes, it updates first
and creates only if Resend reports the contact is missing. Use `--delay-ms` to
pace larger writes if needed. To write a single controlled contact before a full
backfill:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs --apply --max-users 1
```

To inspect only users with failed Clerk email-operation markers, keeping the
default dry-run behavior:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs --flagged-only
```

Apply the marked recovery only after reviewing that output:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs --flagged-only --apply
```

The apply command retries contact syncs and failed welcome events. Welcome-event
recovery first performs the contact-existence deduplication described above. It
requires an explicit `--apply`, does not run automatically, and should be limited
with `--max-users` when used for a controlled recovery. To deliberately re-send
even when the contact exists, add `--force-resend`:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs --flagged-only --apply --force-resend --max-users 1
```

### Read-only suppression reconciliation

Resend's team-level suppression list protects sender reputation after bounces or
complaints. Flaim does not remove suppressions automatically. The reconciliation
script pages through the current Resend Suppressions API, compares masked
addresses with Clerk primary emails, and reports matches without writing to
either provider:

```sh
(
  : "${RESEND_SUPPRESSIONS_API_KEY:?Load a Full access Resend maintenance key from Flaim's password manager first}"
  RESEND_SUPPRESSIONS_API_KEY="$RESEND_SUPPRESSIONS_API_KEY" corepack pnpm --dir web exec node scripts/reconcile-resend-suppressions.mjs
)
unset RESEND_SUPPRESSIONS_API_KEY
```

It requires `CLERK_SECRET_KEY` and `RESEND_SUPPRESSIONS_API_KEY`. Resend does
not offer a read-only API-key permission, so load an existing Full access
maintenance credential into the suppression-specific shell alias without
printing it. Keep it out of `.env.local` and deployed environments, and unset it
after the command. The command itself is always read-only and has no write mode.
Any suppression removal must be reviewed and performed manually in Resend after
the underlying delivery problem is resolved.

React Email's preview server may add lockfile entries for its own bundled Next.js version. Those entries are isolated to the preview tooling; the Flaim web app should continue to resolve the app-pinned Next.js version. Keep the React Email preview packages pinned to exact versions so preview tooling upgrades do not silently churn the lockfile.

## Personalization

**Broadcasts must not depend on `{{{FIRST_NAME}}}` or other name merge fields.** Signup is email verification code only — no name field exists anywhere in the flow, so Resend contacts have no names to merge (verified against all production users, July 2026). A bare `{{{FIRST_NAME}}}` renders as an empty string for every recipient.

- House style is a collective greeting: "Hey everyone," (as used in the July 2026 football send).
- If a merge field is ever used, always include a fallback so it degrades safely: `{{{FIRST_NAME|there}}}`.
- The contact backfill script above only matters if a name source is ever added to signup; until then there is nothing to backfill.

## Clerk templates

Clerk should keep handling auth email. Production Clerk dashboard templates are customized directly in Clerk, then documented here so the dashboard state remains reproducible.

Clerk template editing is dashboard-driven. There is no single shared layout file that automatically updates every Clerk email type, so treat the source below as the canonical frame to paste into each enabled template, then adjust only the title, body copy, action, and security context for that template.

Use this mailing convention for Clerk templates:

- From local part: `accounts`
- Reply-to local part: `support`
- Delivered by Clerk: enabled

Use the dashboard templates to mirror the same basics:

- Header logo: `re-image` using `{{{app.logo_image_url}}}`, backed by the square application logo in Clerk Dashboard > application Settings > Branding. The workspace profile logo does not populate `app.logo_image_url`.
- Logo sizing: 72px. Keep the uploaded source image square and use template sizing for rendered scale.
- Header alignment: logo, `FLAIM FANTASY` label, card/body content, CTA, and footer all share the same left edge.
- Header spacing: 4px top padding above the logo.
- Header color: `#030712`
- Primary button: `#111827` background, `#f8fafc` text, 6px radius
- Body font: system sans-serif
- Footer: `Need help? Email support@flaim.app.`

Canonical Clerk frame:

```html
<re-main background-color="#ffffff" border-radius="8px">
    <re-block align="left" padding="4px 28px 28px 28px" background-color="#ffffff" border-radius="8px">
        <re-image src="{{{app.logo_image_url}}}" alt="{{app.name}} logo" width="72px"></re-image>
        <re-text margin="0px 0px 10px 0px" font-size="12px" font-weight="bold" line-height="18px" color="#6b7280">
            FLAIM FANTASY
        </re-text>

        <!-- Template-specific eyebrow, heading, body, action, and security context go here. -->
    </re-block>
</re-main>
<re-footer padding="18px 28px 0px 28px">
    <re-text font-size="12px" line-height="18px" color="#6b7280">
        Need help? Email <a href="mailto:support@flaim.app">support@flaim.app</a>.
    </re-text>
    <re-text font-size="12px" line-height="18px" color="#6b7280">
        &copy; 2026 Flaim
    </re-text>
</re-footer>
```

Rollout order:

| Group | Template | Subject |
| --- | --- | --- |
| Authentication | Email link - Sign up | `Sign up to Flaim` |
| Authentication | Email link - Verify email | `Verify your email address for Flaim` |
| Authentication | Invitation | `You're invited to Flaim` |
| Authentication | Verification code | `{{otp_code}} is your Flaim verification code` |
| Security | Account Locked | `Your Flaim account has been locked` |
| Security | Password changed | `Your Flaim password has been changed` |
| Security | Password removed | `Your Flaim password has been removed` |
| Security | Primary email address changed | `Your Flaim email address was updated` |
| Security | Reset password code | `{{otp_code}} is your Flaim reset password code` |
| Security | Sign in from new device | `New sign-in to your Flaim account` |

Roll these out in small batches:

1. Core active auth: sign-up link, verify-email link, verification code, invitation.
2. Account/security notices: new device, password changed/removed, account locked, primary email changed, reset password code.
3. Feature-gated templates when enabled: password sign-in/recovery variants, magic-link sign-in, passkey emails, MFA-related emails, strict-enumeration-protection emails, organization emails, waitlist emails, and Clerk Billing emails.

Do a real test email after each batch. Clerk preview is useful for layout, but sent email is the evidence that the `app.logo_image_url` value, logo sizing, and footer alignment survived Clerk/Revolvapp rendering.

Keep Clerk auth/security copy factual and short. Auth email deliverability matters more than clever copy.

Reference points from Clerk's docs:

- Email templates are edited per template in the Clerk Dashboard.
- Preview, copy, revert, and reset are per-template operations.
- Delivered by Clerk, From, Reply-To, and Subject are per-template settings.
- Clerk uses Handlebars variables such as `{{action_url}}`, `{{app.name}}`, `{{app.domain_name}}`, and `{{{app.logo_image_url}}}`.
