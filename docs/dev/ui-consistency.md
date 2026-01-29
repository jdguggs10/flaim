# UI Consistency Guide

Rules for keeping the Next.js frontend visually consistent across light and dark themes.

## Core Rule

**Never use hard-coded Tailwind palette classes** (e.g. `text-zinc-500`, `bg-blue-100`, `text-green-600`, `bg-white`, `text-black`) in component code. Use semantic design tokens instead.

## Token Reference

| Intent | Token class | Defined in |
|---|---|---|
| Primary text | `text-foreground` | `globals.css` `:root` / `.dark` |
| Muted text | `text-muted-foreground` | same |
| Card/surface bg | `bg-card` | same |
| Secondary bg | `bg-secondary` | same |
| Border | `border-border` | same |
| Success (green) | `text-success`, `bg-success`, `bg-success/10` | same |
| Warning (amber) | `text-warning`, `bg-warning`, `bg-warning/20` | same |
| Destructive (red) | `text-destructive`, `bg-destructive`, `bg-destructive/10` | same |
| Info (blue) | `text-info`, `bg-info`, `bg-info/10` | same |

Foreground variants (e.g. `text-success-foreground`) exist for text on solid-color backgrounds.

## Common Replacements

```
text-black        → text-foreground
text-white        → text-background (or text-foreground on dark surfaces)
bg-white          → bg-card
bg-black          → bg-foreground
text-zinc-*       → text-muted-foreground (or text-foreground for darker shades)
text-gray-*       → text-muted-foreground
text-green-*      → text-success
text-red-*        → text-destructive
text-blue-*       → text-info
text-amber-*      → text-warning
bg-green-*        → bg-success or bg-success/10
bg-red-*          → bg-destructive or bg-destructive/10
bg-blue-*         → bg-info or bg-info/10
bg-amber-*        → bg-warning or bg-warning/20
```

## Automated Check

Run `npm run ui:check` to scan for violations. The script lives at `scripts/ui-consistency-check.sh` and greps `web/` for hard-coded palette classes. An allowlist in the script covers legitimate exceptions (e.g. `bg-black/50` overlays).

## Where Tokens Are Defined

- CSS custom properties: `web/app/globals.css` (`:root` and `.dark` blocks)
- Tailwind wiring: `web/tailwind.config.ts` (the `colors` section under `theme.extend`)
- Component variants: `web/components/ui/alert.tsx` and `badge.tsx` (CVA variants for success/warning/info)

## When Adding New Semantic Colors

1. Add HSL values to both `:root` and `.dark` in `globals.css`.
2. Wire them in `tailwind.config.ts` under `theme.extend.colors`.
3. Add CVA variants to Alert and Badge if applicable.
4. Update this doc.
