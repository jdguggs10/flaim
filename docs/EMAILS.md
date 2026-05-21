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

`react-email`, `@react-email/render`, and `resend` are production dependencies because the server send helper renders and sends these templates. `@react-email/ui` remains a dev-only preview dependency; do not remove it just because templates do not import it directly.

This package includes a server-only Resend send helper, but no user action should call it until the corresponding trigger has an explicit send guard and unsubscribe/preference URL. Product email sending stays disabled unless `FLAIM_EMAILS_ENABLED=true` is set.

Clerk is the source of truth for user identity. Resend is the product email audience and delivery layer, not the canonical CRM. The Clerk webhook at `web/app/api/webhooks/clerk/route.ts` keeps Resend contacts lightly synchronized from `user.created` and `user.updated` events. The handler verifies Clerk's webhook signature with `CLERK_WEBHOOK_SIGNING_SECRET` and does nothing unless `RESEND_CONTACT_SYNC_ENABLED=true`.

The contact sync stores only email, first name, last name, and minimal properties (`clerk_user_id`, latest Clerk event, and source). It intentionally does not resubscribe existing contacts during updates, so Resend unsubscribe state remains authoritative for product and broadcast email. If `RESEND_CONTACT_SEGMENT_ID` is set, new and updated contacts are assigned to that Resend Segment for future Broadcast targeting.

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
