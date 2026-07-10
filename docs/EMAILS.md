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
- Resend product emails use the Flaim mark at 28px next to the text wordmark in the header.
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

Export static HTML previews:

```sh
corepack pnpm --dir web run email:export
```

This writes ignored preview HTML to `web/.email-out/`.

Current product templates and broadcast starters are:

- `web/emails/welcome.tsx`
- `web/emails/league-connected.tsx`
- `web/emails/marketing-broadcast.tsx`

Template URL samples exist in `PreviewProps` for local preview only. Production senders must pass app URLs, action URLs, and unsubscribe/preference URLs explicitly from the send call so preview values do not leak into staging or production messages by accident.

## Broadcast workflow

For recurring product or marketing broadcasts, keep the copy and layout in `web/emails/*.tsx`, export the rendered HTML, then create the Resend draft from that exported file. That keeps Flaim's brand rules, button styling, and footer behavior in one place while still using the Resend Broadcast API for the final draft.

Recommended sequence:

```sh
corepack pnpm --dir web run email:export
corepack pnpm --dir web run broadcast:create -- \
  --template marketing-broadcast \
  --segment-id <segment-id> \
  --subject "Product update"
```

Add `--broadcast-id <id>` when you want to refresh an existing Resend draft in place instead of creating a second one.

Use `--send` only when the draft is ready to go, and add `--scheduled-at` if you want Resend to queue it. If you need a text body, pass `--text-file`; otherwise Resend can derive text from the HTML. The `--template` flag keeps the command anchored to the repo template name and automatically looks up `.email-out/<template>.html`.

`@react-email/render`, `resend`, and `server-only` are production dependencies because the server send helper renders and sends these templates. `react-email` and `@react-email/ui` remain dev-only preview dependencies; do not remove `@react-email/ui` just because templates do not import it directly.

This package includes a server-only Resend send helper, but no user action should call it until the corresponding trigger has an explicit send guard and unsubscribe/preference URL. Product email sending stays disabled unless `FLAIM_EMAILS_ENABLED=true` is set.

Clerk is the source of truth for user identity. Resend is the product email audience and delivery layer, not the canonical CRM. The Clerk webhook at `web/app/api/webhooks/clerk/route.ts` handles two separate Resend paths:

- `user.created`: emit the custom Resend event `flaim.user_created` for the welcome automation.
- `user.updated`: lightly repair the Resend contact when `RESEND_CONTACT_SYNC_ENABLED=true`.
- Disabled welcome automation: if `RESEND_WELCOME_AUTOMATION_ENABLED=false`, new `user.created` webhooks do not create or update Resend contacts; signup contact creation is owned by the enabled Resend automation. Run the backfill script for any signup window where the automation was disabled.

The handler verifies Clerk's webhook signature with `CLERK_WEBHOOK_SIGNING_SECRET` and acknowledges verified Clerk events even if downstream Resend work fails, so Resend outages do not create Clerk webhook retry storms.

The maintenance contact sync stores only email, first name, and last name. It updates first and creates only if Resend reports the contact is missing, avoiding a separate contact-existence preflight. It intentionally does not resubscribe existing contacts during updates, so Resend unsubscribe state remains authoritative for product and broadcast email. If `RESEND_CONTACT_SEGMENT_ID` is set, repaired contacts are assigned to that Resend Segment for future Broadcast targeting. Avoid writing custom Resend contact properties unless those properties have first been created in Resend.

The first automated product email is a Resend Automation for new-user welcome email. Flaim does not queue, schedule, create the signup contact, or send this email itself. After a verified Clerk `user.created` webhook passes the `RESEND_WELCOME_AUTOMATION_ENABLED=true` gate, it emits `flaim.user_created` with the user's email and greeting payload. Resend identifies the contact by email, automatically creates a missing contact, adds the contact to the configured Segment, sends the templated welcome email, handles unsubscribe, and records the automation run history. Contact name enrichment remains on the `user.updated` repair path and the backfill script.

Keep welcome delivery gated until the Resend event, template, automation, Segment, and real inbox test are verified. Production delivery requires both `RESEND_WELCOME_AUTOMATION_ENABLED=true` in Flaim and the Resend automation enabled in Resend. The event emitter uses `RESEND_EVENTS_API_KEY` when set, otherwise it falls back to `RESEND_CONTACTS_API_KEY`; do not use the send-only `RESEND_API_KEY` for event/automation management.

Before enabling the flag in production, confirm failed welcome event sends are visible in the production logs or alerting path. The Clerk webhook intentionally acknowledges verified user events even if the downstream Resend event call fails, so a Resend outage or expired events key will not retry through Clerk. Deploy order for welcome automation changes is: deploy the app, rerun `web/scripts/setup-resend-welcome-automation.mjs`, verify a real test email, then re-enable the automation in Resend.

Create or refresh the Resend-side resources with:

```sh
corepack pnpm --dir web exec node scripts/setup-resend-welcome-automation.mjs
```

The setup script creates the `flaim.user_created` event, publishes the `flaim-welcome-v1` template, and creates/updates the `Flaim Welcome Email` automation as `disabled`. It requires `RESEND_CONTACT_SEGMENT_ID` because the automation chain is `trigger -> add_to_segment -> send_email`. The signup automation does not enrich contact names; that remains the responsibility of the `user.updated` repair path and the backfill script. Re-running the script intentionally disables the automation again as a safety guard while templates are being revised. Enable the automation in Resend only after the production webhook event path has been tested.

The Resend automation template is currently hand-built in `web/scripts/setup-resend-welcome-automation.mjs` and must stay visually synchronized with `web/emails/welcome.tsx`. Shared action URLs live in `web/emails/flaim-email-links.json`. When changing the welcome email, update the React preview and setup-script HTML together, run `corepack pnpm --dir web run email:export`, rerun the setup script, and send a real test email before enabling or re-enabling the automation.

Existing users are backfilled or repaired with a separate dry-run-first script. This is not part of the normal signup welcome path. Run it from the repo root:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs
```

The script requires `CLERK_SECRET_KEY` for dry-runs and also requires `RESEND_CONTACTS_API_KEY` when applying writes. `RESEND_API_KEY` should remain the send-only email key; the contact sync key needs Resend Contacts and Segments permissions. The script skips users without a primary email and users whose primary email is explicitly unverified. When applying writes, it updates first and creates only if Resend reports the contact is missing. Use `--delay-ms` to pace larger writes if needed. To write a single controlled contact before a full backfill:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs --apply --max-users 1
```

React Email's preview server may add lockfile entries for its own bundled Next.js version. Those entries are isolated to the preview tooling; the Flaim web app should continue to resolve the app-pinned Next.js version. Keep the React Email preview packages pinned to exact versions so preview tooling upgrades do not silently churn the lockfile.

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
