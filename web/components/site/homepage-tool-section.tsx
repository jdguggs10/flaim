import { ArrowRight } from "lucide-react";

const TOOL_DEFINITIONS = [
  {
    name: "Leagues & Defaults",
    description: "Your connected leagues and preferred starting points.",
  },
  {
    name: "Refresh Leagues",
    description: "Newly available leagues and seasons in Flaim.",
  },
  {
    name: "League Info",
    description: "Rules, scoring, rosters, teams, and owners.",
  },
  {
    name: "Roster",
    description: "Your players and the stats relevant to your league.",
  },
  {
    name: "Matchups",
    description: "Weekly opponents, scores, and matchup status.",
  },
  {
    name: "Standings",
    description: "Rankings, records, and league position.",
  },
  {
    name: "Free Agents",
    description: "Players currently available in your league.",
  },
  {
    name: "Players",
    description: "Player details, current ownership, and availability in your league.",
  },
  {
    name: "Transactions",
    description: "Recent adds, drops, waivers, and trades.",
  },
  {
    name: "League History",
    description: "Past seasons and archived leagues.",
  },
] as const;

const TOOL_GROUPS = [
  {
    title: "Your team",
    description: "Your actual roster and the player details behind it.",
    tools: ["Roster", "Players"],
  },
  {
    title: "Your week",
    description: "Evaluate the matchup and the moves available now.",
    tools: ["Matchups", "Free Agents", "Transactions"],
  },
  {
    title: "Your league",
    description: "Understand the rules and where every team stands.",
    tools: ["League Info", "Standings", "League History"],
  },
  {
    title: "Your account",
    description: "Find the right league before the analysis starts.",
    tools: ["Leagues & Defaults", "Refresh Leagues"],
  },
] as const;

export const HOMEPAGE_TOOL_VARIANTS = [
  "grouped",
  "catalog",
  "minimal",
  "flow",
] as const;

export type HomepageToolVariant = (typeof HOMEPAGE_TOOL_VARIANTS)[number];

export function isHomepageToolVariant(
  value: string | undefined,
): value is HomepageToolVariant {
  return HOMEPAGE_TOOL_VARIANTS.some((variant) => variant === value);
}

function SectionIntro({
  description,
}: {
  description: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <h2 id="league-tools-heading" className="text-3xl font-bold tracking-tight">
        Your Whole League
      </h2>
      <p className="mx-auto mt-3 max-w-2xl leading-7 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function GroupedLayout() {
  return (
    <>
      <SectionIntro
        description="Flaim gives ChatGPT or Claude your roster, matchup, standings, available players, recent moves, and league rules."
      />
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {TOOL_GROUPS.map((group) => (
          <article key={group.title} className="rounded-2xl border bg-background p-5">
            <h3 className="font-semibold">{group.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {group.description}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {group.tools.map((tool) => (
                <span
                  key={tool}
                  className="rounded-full border bg-muted/50 px-3 py-1 text-sm"
                >
                  {tool}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function CatalogLayout() {
  return (
    <>
      <SectionIntro
        description="See exactly which parts of your connected fantasy league Flaim can share with ChatGPT or Claude."
      />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TOOL_DEFINITIONS.map((tool) => (
          <article key={tool.name} className="rounded-xl border bg-background p-4">
            <h3 className="font-semibold">{tool.name}</h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {tool.description}
            </p>
          </article>
        ))}
      </div>
    </>
  );
}

function MinimalLayout() {
  return (
    <>
      <SectionIntro
        description="Your team, your week, and the rest of your league are ready whenever you ask."
      />
      <div className="mx-auto mt-8 max-w-3xl overflow-hidden rounded-3xl border bg-background shadow-sm">
        {TOOL_GROUPS.map((group) => (
          <div
            key={group.title}
            className="grid gap-3 border-b px-5 py-5 last:border-b-0 sm:grid-cols-[8rem_1fr] sm:items-center"
          >
            <h3 className="font-semibold">{group.title}</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              {group.tools.join(" · ")}
            </p>
          </div>
        ))}
      </div>
    </>
  );
}

function FlowLayout() {
  const stages = [
    {
      eyebrow: "Your AI",
      title: "ChatGPT or Claude",
      body: "Ask naturally about the team or league you already manage.",
    },
    {
      eyebrow: "Flaim",
      title: "Checks your whole league",
      body: "Roster, actual matchup, standings, available players, recent moves, league rules, and history.",
    },
    {
      eyebrow: "Your answer",
      title: "Built around your team",
      body: "Advice that reflects your players, your opponent, and what is really available in your league.",
    },
  ] as const;

  return (
    <>
      <SectionIntro
        description="Flaim connects the question you ask with the real team and league information behind the answer."
      />
      <div className="mx-auto mt-8 grid max-w-5xl items-center gap-4 rounded-3xl border bg-background px-6 py-8 shadow-sm md:grid-cols-[1fr_auto_1fr_auto_1fr] md:gap-6">
        {stages.map((stage, index) => (
          <div key={stage.eyebrow} className="contents">
            <article className="px-2 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                {stage.eyebrow}
              </p>
              <h3 className="mt-3 font-semibold">{stage.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {stage.body}
              </p>
            </article>
            {index < stages.length - 1 ? (
              <ArrowRight
                className="mx-auto h-5 w-5 rotate-90 text-muted-foreground md:rotate-0"
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}

export function HomepageToolSection({
  variant = "grouped",
}: {
  variant?: HomepageToolVariant;
}) {
  return (
    <section
      id="tools"
      aria-labelledby="league-tools-heading"
      data-tool-layout={variant}
      className="scroll-mt-20 bg-muted px-4 py-12 sm:px-6 lg:px-8"
    >
      <div className="mx-auto max-w-5xl">
        {variant === "catalog" ? <CatalogLayout /> : null}
        {variant === "minimal" ? <MinimalLayout /> : null}
        {variant === "flow" ? <FlowLayout /> : null}
        {variant === "grouped" ? <GroupedLayout /> : null}
      </div>
    </section>
  );
}
