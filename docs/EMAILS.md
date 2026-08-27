# Email Brand System

Flaim uses a small, restrained email system so product emails, auth emails, and support replies feel like the same product without forcing every provider through one sending service.

## Provider roles

| Provider | Role | Sender |
| --- | --- | --- |
| Zoho | Real inboxes, aliases, and replies | `support@flaim.app` |
| Clerk | Authentication and security emails | `Flaim <accounts@flaim.app>` |
| Resend | Product and lifecycle emails | `Flaim <updates@flaim.app>` |

Use `support@flaim.app` as the reply-to address for product email.

Resend's verified domain is `flaim.app`. The `send.flaim.app` DNS records are for Resend's bounce / MAIL FROM infrastructure, not the visible From address.

## Visual rules

- Keep emails quiet and utilitarian: white card, light gray page background, one primary action.
- Mirror the website tokens in `web/app/globals.css`, but use email-safe hex values in `web/emails/brand.ts`.
- Use shared colors, type, button styling, support footer, and plain-language copy across providers.
- Resend product emails use the Flaim mark at 36px next to the text wordmark in the header. Header content starts 29px from the card edge, matching the card's 1px border plus 28px inner padding.
- Clerk auth emails use the dashboard application logo at 72px with the `FLAIM FANTASY` label. Keep this provider-specific because Clerk/Revolvapp controls the final email HTML.
- Use system fonts, 8px containers, 6px buttons, and plain-language copy.
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
4. Create exactly one provider draft from those exports. Before this step, manually obtain the intended Resend **Segment** ID from the dashboard and load a dedicated full-access broadcast credential into `RESEND_BROADCASTS_API_KEY` from the approved secret manager without printing it. An audience ID is not a segment ID; never substitute one for the other. Do not source this credential from `web/.env.local`: that file's `RESEND_API_KEY` is deliberately sending-only and cannot create broadcasts.

   ```sh
   # From the repository root. Nothing here prints either credential.
   (
     unset RESEND_API_KEY
     : "${RESEND_BROADCASTS_API_KEY:?Load the full-access broadcast key from the approved secret manager first}"
     RESEND_BROADCAST_SEGMENT_ID="...manually verified Segment ID..."

     RESEND_API_KEY="$RESEND_BROADCASTS_API_KEY" corepack pnpm --dir web dlx resend-cli@2.14.0 broadcasts create \
       --from "Flaim <updates@flaim.app>" \
       --reply-to support@flaim.app \
       --subject "Keepers, draft details, and more" \
       --preview-text "Keeper costs, dynasty draft picks, and sharper trade detail for your connected leagues." \
       --name "Football kickoff: keepers + Yahoo" \
       --segment-id "${RESEND_BROADCAST_SEGMENT_ID:?Set a manually verified Resend Segment ID first}" \
       --html-file .email-out/broadcast-2026-08-kickoff.html \
       --text-file .email-out/broadcast-2026-08-kickoff.txt
   )
   unset RESEND_BROADCASTS_API_KEY RESEND_BROADCAST_SEGMENT_ID
   ```

   The subshell first clears any ambient `RESEND_API_KEY`, then passes the dedicated broadcast credential only to the downloaded CLI under the variable name it expects. The segment ID is passed as an argument. The final `unset` clears the two operator-supplied shell variables. Never echo, copy, or commit either value. The command contains no `--send` or `--scheduled-at`, so the CLI creates a draft only. Do not run it with an empty or unverified segment value.
5. Use the Resend dashboard only to confirm the audience, send proof emails, and send after review. Do not edit email content in the dashboard: Resend's editor lock prevents reliable code-side revision after a dashboard edit, so content changes require a new repo export and draft.
6. Comment every real test or audience send on its Linear issue with the draft ID, audience, proof result, and final send state.

Do not send a real email while developing this workflow. The local `RESEND_API_KEY` is sending-only and restricted to `flaim.app`; it must never be broadened for broadcast work. Keep the full-access broadcast credential out of `.env.local`, and do not change provider keys or feature flags as part of routine copy iteration.

The official [`resend-cli` v2 broadcast reference](https://github.com/resend/resend-cli/blob/main/skills/resend-cli/references/broadcasts.md) supports `--html-file`, `--text-file`, `--name`, `--reply-to`, and `--preview-text`, and saves a draft unless `--send` is supplied. It targets the current API's required `segment_id` contract and maps the CLI reply-to input to the API's `reply_to` array. The pinned CLI command above therefore replaces a custom draft creator.

The first product templates are:

- `web/emails/welcome.tsx`
- `web/emails/broadcast-2026-08-kickoff.tsx`
- `web/emails/espn-setup-link.tsx`

Template URL samples exist in `PreviewProps` for local preview only. Production senders must pass app URLs, action URLs, and unsubscribe/preference URLs explicitly from the send call so preview values do not leak into staging or production messages by accident.

## Link attribution

Every `flaim.app` link in an outbound email must carry a `ref` query param naming the campaign (`ref=email-<campaign>`, lowercase/digits/hyphens). This is what makes post-send activity attributable instead of timing-guessed.

- **Code-sent email** (transactional templates, API-created broadcasts): build the URL with `withEmailRef(url, 'email-<campaign>')` from `web/emails/link-ref.ts` at the send call.
- **Dashboard-composed Resend broadcasts**: the helper can't run there — add `?ref=email-<campaign>` to each `flaim.app` link by hand before sending. Treat this as part of the pre-send checklist, alongside the unsubscribe link.
- Do not tag external links (Chrome Web Store, ChatGPT app listing); only Flaim-owned URLs read the param.

Readout: `/leagues` reports a `leagues_page_view` setup signal (with the `ref` value and device class) whenever a signed-in visitor arrives via a tagged link, and includes `ref` on `espn_connect_ui_view`. Query these in the auth-worker's Workers Logs, filtered by `event` and faceted by `ref`.

`@react-email/render`, `resend`, and `server-only` are production dependencies because the server send helper renders and sends these templates. `react-email` and `@react-email/ui` remain dev-only preview dependencies; do not remove `@react-email/ui` just because templates do not import it directly.

This package includes a server-only Resend send helper, but no user action should call it until the corresponding trigger has an explicit send guard and unsubscribe/preference URL. Product email sending stays disabled unless `FLAIM_EMAILS_ENABLED=true` is set.

Clerk is the source of truth for user identity. Resend is the product email audience and delivery layer, not the canonical CRM. The Clerk webhook at `web/app/api/webhooks/clerk/route.ts` handles two separate Resend paths:

- `user.created`: emit the custom Resend event `flaim.user_created` for the welcome automation.
- `user.updated`: lightly repair the Resend contact when `RESEND_CONTACT_SYNC_ENABLED=true`.
- Disabled welcome automation: if `RESEND_WELCOME_AUTOMATION_ENABLED=false`, new `user.created` webhooks do not create or update Resend contacts; signup contact creation is owned by the enabled Resend automation. Run the backfill script for any signup window where the automation was disabled.

The handler verifies Clerk's webhook signature with `CLERK_WEBHOOK_SIGNING_SECRET` and acknowledges verified Clerk events even if downstream Resend work fails, so Resend outages do not create Clerk webhook retry storms.

## Delivery operations and recovery

Email operations emit compact JSON records to Vercel structured logs. The stable
event names are `email.welcome_event_failed`, `email.welcome_event_skipped`,
`email.contact_sync_failed`, `email.send_failed`, `email.bounced`,
`email.complained`, `email.failed`, and `email.delivery_delayed`. Webhook
verification failures use `email.webhook_verification_failed`. These records
include provider-safe IDs and failure categories but never recipient addresses,
raw webhook bodies, signatures, or API keys.

When a Resend welcome event or contact sync fails after a verified Clerk webhook,
Flaim stores the matching retry marker in that user's Clerk private metadata at
`flaim_email_ops.welcomeEvent` or `flaim_email_ops.contactSync`. Clerk's metadata
write is a deep merge, so unrelated private metadata is retained. A retry marker
is never refreshed when it already exists, which prevents marker-caused
`user.updated` webhooks from looping during an outage. A successful contact sync
clears only `contactSync`; it cannot clear a failed `welcomeEvent` marker.

The marker bounds webhook retry loops; it is not an exactly-once delivery
guarantee. Before a flagged recovery re-sends a welcome event, the recovery
command checks whether the Resend contact exists. When the welcome automation
owns contact creation, that is conservative evidence that the prior event landed,
so the command clears the marker and reports a skip instead of sending again.
That deduplication is reliable with the default disabled contact-sync flag and no
preexisting contact. If `RESEND_CONTACT_SYNC_ENABLED=true` or the contact may
have existed before the event, use `--force-resend` for an intentional override.

Direct `resend.emails.send` calls may pass a caller-supplied SDK
`idempotencyKey` only for a genuinely one-time business event with a stable
semantic identifier. The send helper never derives a permanent key from a user
and template: repeatable requests such as an ESPN setup-link resend omit the
option so Resend does not replay-cache a legitimate later request. Resend
currently supports that provider-side idempotency option for email endpoints,
but not for `events.send`. Welcome automation events therefore rely on their
Clerk retry marker and the flagged recovery command below instead of an
unsupported SDK option.

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

The first automated product email is a Resend Automation for new-user welcome email. Flaim does not queue, schedule, create the signup contact, or send this email itself. After a verified Clerk `user.created` webhook passes the `RESEND_WELCOME_AUTOMATION_ENABLED=true` gate, it emits `flaim.user_created` with the user's email plus non-name metadata (`clerk_user_id`, `source`). The welcome template and signup automation do not depend on names. Resend identifies the contact by email, automatically creates a missing contact, adds the contact to the configured Segment, sends the templated welcome email, handles unsubscribe, and records the automation run history. Contact name enrichment remains on the `user.updated` repair path and the backfill script.

Keep welcome delivery gated until the Resend event, template, automation, Segment, and real inbox test are verified. Production delivery requires both `RESEND_WELCOME_AUTOMATION_ENABLED=true` in Flaim and the Resend automation enabled in Resend. The event emitter uses `RESEND_EVENTS_API_KEY` when set, otherwise it falls back to `RESEND_CONTACTS_API_KEY`; do not use the send-only `RESEND_API_KEY` for event/automation management.

Before enabling the flag in production, confirm failed welcome event sends are visible in the production logs or alerting path. The Clerk webhook intentionally acknowledges verified user events even if the downstream Resend event call fails, so a Resend outage or expired events key will not retry through Clerk. Deploy order for welcome automation changes is: deploy the app, disable the `Flaim Welcome Email` automation in the Resend dashboard, rerun `web/scripts/setup-resend-welcome-automation.mjs`, verify a real test email, then re-enable the automation in Resend.

Create or refresh the Resend-side resources with:

```sh
corepack pnpm --dir web exec tsx scripts/setup-resend-welcome-automation.mjs
```

The setup script creates the `flaim.user_created` event, publishes the `flaim-welcome-v1` template, and creates/updates the `Flaim Welcome Email` automation as `disabled`. It requires `RESEND_CONTACT_SEGMENT_ID` (the `Flaim Users` segment id, visible in the Resend Audience → Segments URL) because the automation chain is `trigger -> add_to_segment -> send_email`. **Resend rejects API edits to an enabled automation** ("This automation is enabled and cannot be edited"), so the working order is: disable the automation in the Resend dashboard, run the script (it republishes the template and updates the automation, leaving it disabled), send a real test email, then re-enable it. The script's event and template steps run before the automation step, so if it fails on an enabled automation the template has already been republished; disable and re-run. Verified 2026-08-16. The signup automation does not enrich contact names; that remains the responsibility of the `user.updated` repair path and the backfill script. Re-running the script intentionally disables the automation again as a safety guard while templates are being revised. Enable the automation in Resend only after the production webhook event path has been tested.

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
corepack pnpm --dir web exec node scripts/reconcile-resend-suppressions.mjs
```

It requires `CLERK_SECRET_KEY` and `RESEND_SUPPRESSIONS_API_KEY`, where the
Resend key has read access to Suppressions. The command is always read-only,
and has no write mode. Any suppression removal must be reviewed and performed
manually in Resend after the underlying delivery problem is resolved.

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
