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

The first product templates are:

- `web/emails/welcome.tsx`
- `web/emails/league-connected.tsx`

Template URL samples exist in `PreviewProps` for local preview only. Production senders must pass app URLs, action URLs, and unsubscribe/preference URLs explicitly from the send call so preview values do not leak into staging or production messages by accident.

`@react-email/render`, `resend`, and `server-only` are production dependencies because the server send helper renders and sends these templates. `react-email` and `@react-email/ui` remain dev-only preview dependencies; do not remove `@react-email/ui` just because templates do not import it directly.

This package includes a server-only Resend send helper, but no user action should call it until the corresponding trigger has an explicit send guard and unsubscribe/preference URL. Product email sending stays disabled unless `FLAIM_EMAILS_ENABLED=true` is set.

Clerk is the source of truth for user identity. Resend is the product email audience and delivery layer, not the canonical CRM. The Clerk webhook at `web/app/api/webhooks/clerk/route.ts` keeps Resend contacts lightly synchronized from `user.created` and `user.updated` events. The handler verifies Clerk's webhook signature with `CLERK_WEBHOOK_SIGNING_SECRET`, acknowledges verified Clerk events even if downstream Resend sync fails, and does nothing unless `RESEND_CONTACT_SYNC_ENABLED=true`.

The contact sync stores only email, first name, and last name. It intentionally does not resubscribe existing contacts during updates, so Resend unsubscribe state remains authoritative for product and broadcast email. If `RESEND_CONTACT_SEGMENT_ID` is set, new and updated contacts are assigned to that Resend Segment for future Broadcast targeting. Avoid writing custom Resend contact properties unless those properties have first been created in Resend.

The first automated product email is a Resend Automation for new-user welcome email. Flaim does not queue or schedule this email itself. After a verified Clerk `user.created` webhook successfully syncs the Resend contact, the webhook emits the custom Resend event `flaim.user_created`. Resend owns the automation run, email rendering, unsubscribe handling, and run history.

Keep the welcome automation behind `RESEND_WELCOME_AUTOMATION_ENABLED=true` until the Resend event, template, automation, and real inbox test are verified. The event emitter uses `RESEND_EVENTS_API_KEY` when set, otherwise it falls back to `RESEND_CONTACTS_API_KEY`; do not use the send-only `RESEND_API_KEY` for event/automation management.

Before enabling the flag in production, confirm failed welcome event sends are visible in the production logs or alerting path. The Clerk webhook intentionally acknowledges verified user events even if the downstream Resend event call fails, so a Resend outage or expired events key will not retry through Clerk.

Create or refresh the Resend-side resources with:

```sh
corepack pnpm --dir web exec node scripts/setup-resend-welcome-automation.mjs
```

The setup script creates the `flaim.user_created` event, publishes the `flaim-welcome-v1` template, and creates/updates the `Flaim Welcome Email` automation as `disabled`. Re-running the script intentionally disables the automation again as a safety guard while templates are being revised. Enable the automation in Resend only after the production webhook event path has been tested.

The Resend automation template is currently hand-built in `web/scripts/setup-resend-welcome-automation.mjs` and must stay visually synchronized with `web/emails/welcome.tsx`. Shared action URLs live in `web/emails/flaim-email-links.json`. When changing the welcome email, update the React preview and setup-script HTML together, run `corepack pnpm --dir web run email:export`, rerun the setup script, and send a real test email before enabling or re-enabling the automation.

Existing users are backfilled with a separate dry-run-first script. Run it from the repo root:

```sh
corepack pnpm --dir web exec node scripts/backfill-resend-contacts.mjs
```

The script requires `CLERK_SECRET_KEY` for dry-runs and also requires `RESEND_CONTACTS_API_KEY` when applying writes. `RESEND_API_KEY` should remain the send-only email key; the contact sync key needs Resend Contacts and Segments permissions. The script skips users without a primary email and users whose primary email is explicitly unverified. Use `--delay-ms` to pace larger writes if needed. To write a single controlled contact before a full backfill:

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
