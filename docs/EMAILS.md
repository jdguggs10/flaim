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

This package intentionally does not include a Resend send path yet. Add the Resend SDK with the first API route, Server Action, or worker that actually sends one of these templates.

## Clerk templates

Clerk should keep handling auth email. Use the dashboard templates to mirror the same basics:

- Text wordmark: `Flaim`
- Header color: `#030712`
- Primary button: `#111827` background, `#f8fafc` text, 6px radius
- Body font: system sans-serif
- Footer: `Need help? Email support@flaim.app.`

Keep Clerk's default auth/security wording unless there is a concrete product reason to change it. Auth email deliverability matters more than clever copy.
