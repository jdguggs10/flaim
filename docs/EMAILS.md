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

The first product templates are:

- `web/emails/welcome.tsx`
- `web/emails/league-connected.tsx`

Template URL samples exist in `PreviewProps` for local preview only. Production senders must pass app URLs, action URLs, and unsubscribe/preference URLs explicitly from the send call so preview values do not leak into staging or production messages by accident.

`react-email` and `@react-email/ui` are dev-only preview/export dependencies for now. The preview server uses `@react-email/ui`; do not remove it just because templates do not import it directly.

This package intentionally does not include a Resend send path yet. When the first API route, Server Action, or worker sends one of these templates, add the Resend SDK and move `react-email` from `devDependencies` to production `dependencies` so the renderer is available outside the local preview/export workflow.

React Email's preview server may add lockfile entries for its own bundled Next.js version. Those entries are isolated to the preview tooling; the Flaim web app should continue to resolve the app-pinned Next.js version. Keep the React Email preview packages pinned to exact versions so preview tooling upgrades do not silently churn the lockfile.

## Clerk templates

Clerk should keep handling auth email. Use the dashboard templates to mirror the same basics:

- Text wordmark: `Flaim`
- Header color: `#030712`
- Primary button: `#111827` background, `#f8fafc` text, 6px radius
- Body font: system sans-serif
- Footer: `Need help? Email support@flaim.app.`

Keep Clerk's default auth/security wording unless there is a concrete product reason to change it. Auth email deliverability matters more than clever copy.
