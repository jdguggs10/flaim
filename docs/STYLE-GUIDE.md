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

## Copy: Homepage vs Guides

The homepage and guide pages have different copy rules.

- **Homepage — human-first.** Warm, conversational, personal. Name real users ("Gerry's roster"), speak to the visitor ("What you can ask"), lead with relatable pain ("Stop copying stats into ChatGPT"). No jargon, no feature-list phrasing, no third-person references to Flaim. Structured data schemas handle keyword density invisibly.
- **Guide pages — keyword-rich.** `/guide/platforms`, `/guide/ai`, `/guide/sports` are the long-tail SEO surface. Detailed, instructional, keyword-specific — visitors are already in setup mode.
- **Rule of thumb:** If you'd read it aloud to a friend, it belongs on the homepage. If you'd scan it while following steps, it belongs in a guide.

## Verification

- Run `corepack pnpm run ui:check` for token/palette consistency.
- Run `corepack pnpm run lint` before shipping frontend changes.
