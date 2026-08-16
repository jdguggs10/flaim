# Style Guide

Lightweight in-repo frontend standards.

## Core Rules

- Use semantic design tokens (`text-foreground`, `bg-card`, `border-border`) instead of hard-coded palette classes.
- Preserve clear focus states and keyboard accessibility for interactive elements.
- Prefer existing shared UI primitives before introducing custom one-off patterns.

## Component Baseline

- Use `Alert`, `Badge`, `Button`, and `Card` variants consistently.
- Keep destructive actions visually distinct.
- Use concise, plain-language UI copy.

## Copy: Homepage vs Docs

The homepage and docs pages have different copy rules.

- **Homepage — human-first.** Warm, conversational, personal. The live demo should be honest that it runs on Gerry's actual fantasy league data, while making clear visitors can connect their own leagues. Speak to the visitor ("What you can ask"), lead with relatable pain ("Stop copying stats into ChatGPT"). No jargon, no feature-list phrasing, no third-person references to Flaim. Structured data schemas handle keyword density invisibly.
- **Docs pages — keyword-rich.** `/docs`, `/docs/flaim`, `/docs/platforms`, `/docs/ai`, and `/docs/sports` are the long-tail SEO, GEO, and AI-reference surface. Detailed, instructional, keyword-specific — visitors are already in setup mode. Label them "Docs," not "Help" or "Guide": the product is meant to be self-explanatory, and "help" implies otherwise. Legacy `/guide/*` URLs redirect permanently.
- **Rule of thumb:** If you'd read it aloud to a friend, it belongs on the homepage. If you'd scan it while following steps, it belongs in the docs.

## Verification

- Run `corepack pnpm run ui:check` for token/palette consistency.
- Run `corepack pnpm run lint` before shipping frontend changes.
