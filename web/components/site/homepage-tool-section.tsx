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
    description: "Player lookup with league and market context.",
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
    title: "Your account",
    description: "Find the right league before the analysis starts.",
    tools: ["Leagues & Defaults", "Refresh Leagues"],
  },
  {
    title: "Your league",
    description: "Understand the rules and where every team stands.",
    tools: ["League Info", "Standings", "League History"],
  },
  {
    title: "Your team",
    description: "Give your AI the roster and player context it needs.",
    tools: ["Roster", "Players"],
  },
  {
    title: "Your week",
    description: "Evaluate the matchup and the moves available now.",
    tools: ["Matchups", "Free Agents", "Transactions"],
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
  eyebrow,
  heading,
  description,
}: {
  eyebrow: string;
  heading: string;
  description: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
        {eyebrow}
      </p>
      <h2 id="league-tools-heading" className="mt-3 text-3xl font-bold tracking-tight">
        {heading}
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
        eyebrow="10 read-only league tools"
        heading="The league context your AI can use"
        description="Flaim gives ChatGPT or Claude the specific league data behind a useful answer."
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
        eyebrow="10 read-only league tools"
        heading="What Flaim can bring into the conversation"
        description="Each tool gives your AI one reliable slice of your connected fantasy league."
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
        eyebrow="10 read-only league tools"
        heading="Your league, available to your AI"
        description="Roster, matchup, standings, waivers, transactions, history, and the context that ties them together."
      />
      <div className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2.5">
        {TOOL_DEFINITIONS.map((tool) => (
          <span
            key={tool.name}
            className="rounded-full border bg-background px-4 py-2 text-sm font-medium shadow-sm"
          >
            {tool.name}
          </span>
        ))}
      </div>
    </>
  );
}

function FlowLayout() {
  const stages = [
    {
      eyebrow: "Your leagues",
      title: "ESPN, Yahoo, and Sleeper",
      body: "Connect the fantasy platforms where your teams already live.",
    },
    {
      eyebrow: "Flaim",
      title: "10 read-only league tools",
      body: "Roster, matchups, standings, free agents, transactions, history, and more.",
    },
    {
      eyebrow: "Your AI",
      title: "ChatGPT or Claude",
      body: "Ask naturally while Flaim supplies the league context behind the answer.",
    },
  ] as const;

  return (
    <>
      <SectionIntro
        eyebrow="Connected league context"
        heading="From your fantasy platform to a useful answer"
        description="Flaim handles the connection between the leagues you manage and the AI you already use."
      />
      <div className="mt-8 grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        {stages.map((stage, index) => (
          <div key={stage.eyebrow} className="contents">
            <article className="rounded-2xl border bg-background p-5">
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
                className="mx-auto hidden h-5 w-5 self-center text-muted-foreground md:block"
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
