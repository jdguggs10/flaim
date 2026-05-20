# Email Brand System

Flaim uses a small, restrained email system so product emails, auth emails, and support replies feel like the same product without forcing every provider through one sending service.

## Provider roles

| Provider | Role | Sender |
| --- | --- | --- |
| Zoho | Real inboxes, aliases, and replies | `support@flaim.app` |
| Clerk | Authentication and security emails | `Flaim <accounts@flaim.app>` |
| Resend | Product and lifecycle emails | `Flaim <updates@send.flaim.app>` |

Use `support@flaim.app` as the reply-to address for product email.

## Visual rules

- Keep emails quiet and utilitarian: white card, light gray page background, one primary action.
- Mirror the website tokens in `web/app/globals.css`, but use email-safe hex values in `web/emails/brand.ts`.
- Use the Flaim mark at 28px next to the text wordmark in the header.
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

`react-email` and `@react-email/ui` are dev-only preview/export dependencies for now. The preview server uses `@react-email/ui`; do not remove it just because templates do not import it directly.

This package intentionally does not include a Resend send path yet. When the first API route, Server Action, or worker sends one of these templates, add the Resend SDK and move `react-email` from `devDependencies` to production `dependencies` so the renderer is available outside the local preview/export workflow.

React Email's preview server may add lockfile entries for its own bundled Next.js version. Those entries are isolated to the preview tooling; the Flaim web app should continue to resolve the app-pinned Next.js version. Keep the React Email preview packages pinned to exact versions so preview tooling upgrades do not silently churn the lockfile.

## Clerk templates

Clerk should keep handling auth email. The production Clerk dashboard templates have been customized directly for the active Authentication and Security email types.

Use this mailing convention for Clerk templates:

- From local part: `accounts`
- Reply-to local part: `support`
- Delivered by Clerk: enabled

Use the dashboard templates to mirror the same basics:

- Header logo: Clerk `{{> app_logo}}` partial, backed by the square application logo in Clerk Dashboard > application Settings > Branding. The workspace profile logo does not populate `app.logo_image_url`.
- Logo sizing: Clerk/Revolvapp normalizes the app logo image to a 128px rendered image in preview and sent test emails. Attempts to shrink it with `re-image width`, raw `img` markup, `re-style` CSS, static hosted image URLs, or `re-social-item` either render at 128px, get stripped, or break variable rendering. Keep Clerk auth templates on the native `{{> app_logo}}` partial; use the smaller 28px mark only in Resend/React Email templates where Flaim controls the HTML.
- Header color: `#030712`
- Primary button: `#111827` background, `#f8fafc` text, 6px radius
- Body font: system sans-serif
- Footer: `Need help? Email support@flaim.app.`

Customized production templates:

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

Unavailable templates are intentionally untouched until the corresponding Clerk features are enabled. As of this pass, that includes magic-link sign-in, strict-enumeration-protection emails, passkey emails, organization emails, waitlist emails, and Clerk Billing emails.

Keep Clerk auth/security copy factual and short. Auth email deliverability matters more than clever copy.
