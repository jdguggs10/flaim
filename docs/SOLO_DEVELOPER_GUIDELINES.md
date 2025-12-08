# Solo Developer Guidelines (Short)

Context: first production project, one part-time developer. Favor boring, stable, documented solutions. OpenAI usage is via the **Responses API** (not chat completions).

## Principles
- Ship working, simple features; avoid refactors that touch many files.
- Choose mainstream tech: Next.js, Vercel, Clerk, Cloudflare Workers, TypeScript, Tailwind.
- Prefer framework defaults, REST over GraphQL, env vars over config systems.
- Copy from official docs/examples before inventing custom patterns.
- Avoid over-engineering (microservices, complex state, fancy DevOps, bleeding-edge libs).

## When Deciding
- Pick options that can be done in 1–2 hours with current stack knowledge.
- Limit new concepts; one new thing at a time.
- Prioritize stability and maintenance cost over elegance or performance tweaks.

## Red Flags
- “Future-proof” changes that add services or configs.
- Suggestions needing multiple new tools or custom auth/state/caching.
- Big refactors, “quick” upgrades that change build tooling, or heavy monitoring setups.

## If Stuck
- Look for existing solutions and official docs; ask community if needed.
- Keep changes small; revert to last known good state if overwhelmed.
- Focus on user impact; pause new features when fixing breakage.
