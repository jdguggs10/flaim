# Style Guide

Lightweight in-repo frontend standards.

## Core Rules

- Use semantic design tokens (`text-foreground`, `bg-card`, `border-border`) instead of hard-coded palette classes.
- Preserve clear focus states and keyboard accessibility for interactive elements.
- Keep site/chat boundaries intact (`components/site` and `components/chat` do not cross-import).
- Prefer existing shared UI primitives before introducing custom one-off patterns.

## Component Baseline

- Use `Alert`, `Badge`, `Button`, and `Card` variants consistently.
- Keep destructive actions visually distinct.
- Use concise, plain-language UI copy.

## Verification

- Run `npm run ui:check` for token/palette consistency.
- Run `npm run lint` before shipping frontend changes.
