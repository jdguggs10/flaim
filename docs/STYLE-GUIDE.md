# Style Guide

Design standards and code conventions for Flaim's Next.js frontend. This guide ensures consistency across light/dark themes and maintains a cohesive user experience.

## Philosophy

- **Pragmatic over perfect**: Focus on what matters for a solo indie project
- **Consistency first**: Predictable patterns over clever solutions
- **Accessible by default**: WCAG AA compliance as baseline
- **Mobile-friendly**: Responsive design from the start

## Design Tokens

### Colors

**Core Rule**: Never use hard-coded Tailwind palette classes (e.g., `text-zinc-500`, `bg-blue-100`, `text-green-600`, `bg-white`, `text-black`). Always use semantic design tokens.

| Intent | Token class | Usage |
|--------|-------------|-------|
| Primary text | `text-foreground` | Main text content |
| Muted text | `text-muted-foreground` | Secondary text, labels |
| Card/surface bg | `bg-card` | Elevated surfaces, panels |
| Secondary bg | `bg-secondary` | Subtle backgrounds |
| Border | `border-border` | Dividers, outlines |
| Success (green) | `text-success`, `bg-success`, `bg-success/10` | Positive states, confirmations |
| Warning (amber) | `text-warning`, `bg-warning`, `bg-warning/20` | Cautions, alerts |
| Destructive (red) | `text-destructive`, `bg-destructive`, `bg-destructive/10` | Errors, dangerous actions |
| Info (blue) | `text-info`, `bg-info`, `bg-info/10` | Informational messages |

**Foreground variants** (e.g., `text-success-foreground`) provide accessible contrast for text on solid-color backgrounds.

**Common replacements:**
```
text-black        → text-foreground
text-white        → text-background (or text-foreground on dark surfaces)
bg-white          → bg-card
bg-black          → bg-foreground
text-zinc-*       → text-muted-foreground (or text-foreground for emphasis)
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

**Where tokens are defined:**
- CSS custom properties: `web/app/globals.css` (`:root` and `.dark` blocks)
- Tailwind wiring: `web/tailwind.config.ts` (under `theme.extend.colors`)
- Component variants: `web/components/ui/alert.tsx` and `badge.tsx`

### Typography

**Font Stack**:
- System font stack via `font-sans` (Inter or system fallbacks)
- Monospace for code: `font-mono`

**Scale** (via Tailwind defaults):
- `text-xs` (0.75rem / 12px) — Captions, metadata
- `text-sm` (0.875rem / 14px) — Body text, labels
- `text-base` (1rem / 16px) — Default body text
- `text-lg` (1.125rem / 18px) — Emphasized body text
- `text-xl` (1.25rem / 20px) — Small headings
- `text-2xl` (1.5rem / 24px) — Section headings
- `text-3xl` (1.875rem / 30px) — Page headings
- `text-4xl` (2.25rem / 36px) — Hero headings

**Heading hierarchy**:
- `h1` — Page title (typically `text-3xl` or `text-4xl font-bold`)
- `h2` — Major section (typically `text-2xl font-semibold`)
- `h3` — Subsection (typically `text-xl font-semibold`)
- `h4` — Minor heading (typically `text-lg font-medium`)

**Weight**:
- `font-normal` (400) — Body text
- `font-medium` (500) — Emphasized text, labels
- `font-semibold` (600) — Section headings
- `font-bold` (700) — Page titles, primary actions

### Spacing

**Scale** (Tailwind defaults):
- Use multiples of 4: `4`, `8`, `12`, `16`, `20`, `24`, `32`, `40`, `48`, `64`
- Gap between sections: `space-y-6` or `space-y-8`
- Card padding: `p-4` or `p-6`
- Button padding: `px-4 py-2` (default) or `px-6 py-3` (large)
- Page margins: `max-w-4xl mx-auto px-4`

**Responsive spacing**:
- Mobile: Smaller padding (`p-4`, `space-y-4`)
- Desktop: More generous spacing (`md:p-6`, `md:space-y-6`)

### Borders & Shadows

**Border radius**:
- Small elements (badges, tags): `rounded-sm` or `rounded`
- Cards, buttons: `rounded-lg`
- Large surfaces: `rounded-xl`
- Circular: `rounded-full` (avatars, icon buttons)

**Shadows** (via shadcn/ui):
- Subtle elevation: `shadow-sm`
- Card elevation: `shadow-md`
- Modal/popover: `shadow-lg`

## Component Guidelines

### When to use what

**Alert** (`components/ui/alert.tsx`):
- Use for important in-page messages
- Variants: `default`, `success`, `warning`, `destructive`, `info`
- Example: "Your leagues have been synced successfully"

**Badge** (`components/ui/badge.tsx`):
- Use for status indicators, labels, tags
- Variants: `default`, `secondary`, `success`, `warning`, `destructive`, `info`, `outline`
- Example: "DEBUG" badge, environment indicators

**Button** (`components/ui/button.tsx`):
- Primary action: `variant="default"`
- Secondary action: `variant="outline"`
- Destructive action: `variant="destructive"`
- Subtle action: `variant="ghost"`
- Size: `size="sm"` for compact UIs, `size="lg"` for emphasis

**Card** (`components/ui/card.tsx`):
- Use for grouped content, panels
- Structure: `<Card>` → `<CardHeader>` → `<CardTitle>` / `<CardDescription>` → `<CardContent>` → `<CardFooter>`

**Dialog/Modal** (`components/ui/dialog.tsx`):
- Use for focused tasks, confirmations
- Always include close button
- Keep content concise

**Popover** (`components/ui/popover.tsx`):
- Use for contextual information, non-critical actions
- Prefer over Dialog for lightweight interactions

**Tooltip** (`components/ui/tooltip.tsx`):
- Use for icon button labels, supplementary info
- Keep text short (1-2 words ideal)

### Component anti-patterns

❌ **Don't**:
- Stack multiple Alerts on a page (use one Alert with combined message)
- Use Dialog for simple confirmations (use AlertDialog)
- Hardcode colors in custom components (use design tokens)
- Create one-off button styles (extend Button component)
- Use `div` when semantic HTML exists (`article`, `section`, `nav`)

✅ **Do**:
- Compose shadcn/ui primitives instead of building from scratch
- Use semantic HTML elements
- Extend existing components via className
- Keep component variants in sync with design tokens

## Layout Standards

### Responsive Breakpoints

Tailwind defaults:
- `sm`: 640px
- `md`: 768px
- `lg`: 1024px
- `xl`: 1280px
- `2xl`: 1536px

**Mobile-first approach**: Write base styles for mobile, add `md:` and `lg:` modifiers for larger screens.

### Container Widths

- Full width pages: No max-width
- Content pages: `max-w-4xl mx-auto px-4`
- Narrow forms: `max-w-md mx-auto px-4`
- Wide dashboards: `max-w-7xl mx-auto px-4`

### Grid & Flex

**Grid**: Use for uniform layouts (card grids, form layouts)
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

**Flex**: Use for dynamic layouts (navigation, button groups)
```tsx
<div className="flex items-center justify-between gap-4">
```

## Accessibility

### Minimum Requirements

- **Color contrast**: WCAG AA (4.5:1 for normal text, 3:1 for large text)
- **Focus states**: Visible on all interactive elements (via `focus-visible:ring`)
- **Semantic HTML**: Use proper elements (`button`, `nav`, `article`, etc.)
- **Alt text**: All images must have descriptive `alt` attributes
- **Keyboard navigation**: All interactive elements accessible via Tab, Enter, Space
- **ARIA labels**: Use on icon-only buttons and complex widgets

### Focus Management

- Use `focus-visible:ring-2 focus-visible:ring-offset-2` for custom interactive elements
- shadcn/ui components handle focus by default
- Trap focus in modals/dialogs (shadcn Dialog does this automatically)

### Screen Readers

- Use `sr-only` class for screen-reader-only text
- Provide context for icon buttons: `<Button aria-label="Close menu">`
- Use `aria-describedby` for supplementary information

## Code Conventions

### File Organization

```
web/
├── app/                    # Next.js app router pages
├── components/
│   ├── ui/                 # shadcn/ui primitives
│   ├── chat/               # Feature-specific components
│   ├── leagues/
│   └── ...
├── lib/                    # Utilities, hooks, helpers
├── stores/                 # Zustand stores
└── styles/
    └── globals.css         # Design tokens
```

### Component Structure

**Prefer functional components**:
```tsx
export function MyComponent({ prop1, prop2 }: MyComponentProps) {
  // State
  const [value, setValue] = useState<string>('')

  // Effects
  useEffect(() => {
    // ...
  }, [])

  // Handlers
  const handleClick = () => {
    // ...
  }

  // Render
  return (
    <div className="space-y-4">
      {/* ... */}
    </div>
  )
}
```

### Class Name Ordering

**Recommended order** (for readability):
1. Layout: `flex`, `grid`, `block`, `inline`
2. Positioning: `relative`, `absolute`, `top-0`
3. Sizing: `w-full`, `h-screen`, `max-w-md`
4. Spacing: `p-4`, `m-2`, `space-y-4`, `gap-4`
5. Typography: `text-lg`, `font-bold`, `text-foreground`
6. Visual: `bg-card`, `border`, `rounded-lg`, `shadow-md`
7. Interactivity: `hover:bg-secondary`, `focus:ring-2`
8. Responsive: `md:flex`, `lg:grid-cols-3`

**Use `cn()` helper** for conditional classes:
```tsx
import { cn } from '@/lib/utils'

<div className={cn(
  "base-class",
  isActive && "active-class",
  className
)}>
```

### Naming Conventions

- **Components**: PascalCase (`UserProfile.tsx`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Constants**: UPPER_SNAKE_CASE (`API_BASE_URL`)
- **CSS classes**: kebab-case (only for custom CSS, rare in Tailwind projects)

## Enforcement

### Automated Checks

**Color consistency**: Run `npm run ui:check` to detect hard-coded palette classes.
- Script: `scripts/ui-consistency-check.sh`
- Scans: `web/` directory for violations
- Allowlist: Legitimate exceptions (overlays, specific cases)

**Linting**: Run `npm run lint` for ESLint + Prettier checks.

**Type checking**: Run `npm run type-check` (if configured) or `npx tsc --noEmit` in `web/`.

### Manual Review

- [ ] All new components use design tokens (no hard-coded colors)
- [ ] Responsive behavior tested on mobile + desktop
- [ ] Focus states visible on all interactive elements
- [ ] No accessibility violations (use browser dev tools)
- [ ] Component follows shadcn/ui patterns where applicable

## Adding New Design Tokens

**Process**:
1. Add HSL values to both `:root` and `.dark` in `web/app/globals.css`
2. Wire in `web/tailwind.config.ts` under `theme.extend.colors`
3. Add CVA variants to Alert and Badge if applicable
4. Update this guide with usage examples
5. Run `npm run ui:check` to verify no violations

## Branding & Assets

### Logo — 2-Tier System

The Flaim logo is a flaming baseball. Two source marks exist (both 1024x1024 B&W PNGs):

1. **Icon mark** (`docs/branding/flaim-mark-icon-bw.png`) — Simplified: no interior halftone, thick stitches, bold flame tongues. Used for all small-size assets where legibility matters.
2. **Hero mark** (`docs/branding/flaim-mark-hero-bw.png`) — Full detail: stipple texture, fine flame detail. Used at display sizes in the site header and marketing.

**Rule of thumb:** If it needs to read as "flaming ball" at 24px, use the icon mark. Otherwise use the hero mark.

### Asset Inventory

**From icon mark** (white background, threshold pipeline):

| File | Size | Purpose |
|------|------|---------|
| `web/app/favicon.ico` | 16/32px | Browser tab icon |
| `web/app/apple-icon.png` | 180px | iOS home screen icon |
| `web/app/icon.png` | 512px | General web app icon / PWA |
| `extension/assets/icons/icon-16.png` | 16px | Chrome extension UI |
| `extension/assets/icons/icon-48.png` | 48px | Chrome extension UI |
| `extension/assets/icons/icon-128.png` | 128px | Chrome Web Store listing |

**From hero mark** (transparent background):

| File | Size | Purpose |
|------|------|---------|
| `web/public/flaim-mark-hero.png` | 512px | Site header logo (light mode) |
| `web/public/flaim-mark-hero-dark.png` | 512px | Site header logo (dark mode, white artwork) |

**Metadata references:**
- `web/app/layout.tsx` — Next.js `metadata.icons` (favicon + apple icon)
- `extension/manifest.json` — `icons` and `default_icon` fields
- `web/components/site/site-header.tsx` — Hero mark in site header
- `web/components/chat/chat-header.tsx` — Hero mark in chat header

### Other Images

| File | Purpose |
|------|---------|
| `web/public/openai_logo.svg` | OpenAI branding on AI setup step |

### Regenerating Icons

**Icon mark** → favicon, apple icon, extension icons (anti-aliased resize, transparent background):

```bash
SRC=docs/branding/flaim-mark-icon-bw.png

# Favicon (16 + 32 + 48px ICO — 48px for Retina tabs)
magick $SRC -resize 16x16 -fuzz 10% -transparent white /tmp/16.png
magick $SRC -resize 32x32 -fuzz 10% -transparent white /tmp/32.png
magick $SRC -resize 48x48 -fuzz 10% -transparent white /tmp/48.png
magick /tmp/16.png /tmp/32.png /tmp/48.png web/app/favicon.ico

# Apple icon + general icon
magick $SRC -resize 180x180 -fuzz 10% -transparent white web/app/apple-icon.png
magick $SRC -resize 512x512 -fuzz 10% -transparent white web/app/icon.png

# Extension icons
magick $SRC -resize 16x16 -fuzz 10% -transparent white extension/assets/icons/icon-16.png
magick $SRC -resize 48x48 -fuzz 10% -transparent white extension/assets/icons/icon-48.png
magick $SRC -resize 128x128 -fuzz 10% -transparent white extension/assets/icons/icon-128.png
```

**Hero mark** → site header logo (resize, make white transparent, no threshold):

```bash
magick docs/branding/flaim-mark-hero-bw.png -fuzz 10% -transparent white -resize 512x512 web/public/flaim-mark-hero.png
magick web/public/flaim-mark-hero.png -channel RGB -negate +channel web/public/flaim-mark-hero-dark.png
```

## Resources

- [shadcn/ui docs](https://ui.shadcn.com/) — Component library
- [Tailwind CSS docs](https://tailwindcss.com/docs) — Utility classes
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/) — Accessibility standards
- [Radix UI docs](https://www.radix-ui.com/) — Primitives (used by shadcn/ui)
