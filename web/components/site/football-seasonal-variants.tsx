import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CirclePlay,
  MessageCircleQuestion,
  Search,
  Sparkles,
  Trophy,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { FootballStrikeReveal } from "@/components/site/football-strike-reveal";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
} from "@/lib/product-links";

export const FOOTBALL_VARIANTS = [
  {
    id: "season-chapters",
    label: "Season Chapters",
    description: "Clean editorial",
  },
  {
    id: "question-journey",
    label: "Question Journey",
    description: "Conversation-led",
  },
  {
    id: "season-timeline",
    label: "Season Timeline",
    description: "Visual progression",
  },
] as const;

export type FootballVariantId = (typeof FOOTBALL_VARIANTS)[number]["id"];

export const DEFAULT_FOOTBALL_VARIANT: FootballVariantId = "season-chapters";

export const FOOTBALL_CONTRAST_VARIANTS = [
  {
    id: "strike-and-replace",
    label: "Clean Line",
    description: "Editorial grid",
  },
  {
    id: "coach-marker",
    label: "Coach's Scribble",
    description: "Hand-drawn cards",
  },
  {
    id: "x-it-out",
    label: "Red Pen",
    description: "Full X marks",
  },
  {
    id: "marker-wipe",
    label: "Marker Swipe",
    description: "Bold floating pills",
  },
  {
    id: "playbook-route",
    label: "Playbook Trail",
    description: "Numbered route",
  },
  {
    id: "fade-and-replace",
    label: "Fade Away",
    description: "Oversized dissolve",
  },
] as const;

export type FootballContrastVariantId =
  (typeof FOOTBALL_CONTRAST_VARIANTS)[number]["id"];

export const DEFAULT_FOOTBALL_CONTRAST_VARIANT: FootballContrastVariantId =
  "strike-and-replace";

export function isFootballVariant(value: string): value is FootballVariantId {
  return FOOTBALL_VARIANTS.some((variant) => variant.id === value);
}

export function isFootballContrastVariant(
  value: string,
): value is FootballContrastVariantId {
  return FOOTBALL_CONTRAST_VARIANTS.some((variant) => variant.id === value);
}

export function FootballVariantSwitcher({
  activeVariant,
}: {
  activeVariant: FootballVariantId;
}) {
  return (
    <aside className="border-b bg-muted/60 px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Seasonal page lab, round two
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Three alternating season-story directions. Choose one to compare the
            full page.
          </p>
        </div>
        <nav
          className="grid gap-2 sm:grid-cols-3"
          aria-label="Choose a fantasy football page variant"
        >
          {FOOTBALL_VARIANTS.map((variant) => {
            const isActive = variant.id === activeVariant;

            return (
              <Link
                key={variant.id}
                href={`/fantasy-football?variant=${variant.id}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={`rounded-xl border px-4 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background hover:border-foreground/25"
                }`}
              >
                <span className="block text-sm font-semibold">
                  {variant.label}
                </span>
                <span
                  className={`mt-0.5 block text-xs ${
                    isActive
                      ? "text-primary-foreground/75"
                      : "text-muted-foreground"
                  }`}
                >
                  {variant.description}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}

export function FootballConnectionButtons({
  primaryLabel = "First Connect Your Leagues",
}: {
  primaryLabel?: string;
}) {
  return (
    <div className="grid w-full max-w-lg grid-cols-2 gap-3">
      <Button asChild size="lg" className="col-span-2 w-full">
        <Link href="/leagues">{primaryLabel}</Link>
      </Button>
      <Button asChild size="lg" variant="outline" className="w-full">
        <a href={CHATGPT_APP_URL} target="_blank" rel="noopener noreferrer">
          Add ChatGPT Plugin
        </a>
      </Button>
      <Button asChild size="lg" variant="outline" className="w-full">
        <a
          href={CLAUDE_CONNECTOR_DIRECTORY_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Add Claude Plugin
        </a>
      </Button>
    </div>
  );
}

const SEASON_MOMENTS = [
  {
    id: "draft-night",
    label: "Draft night",
    question: "Grade the team I drafted.",
    title: "A roster grade that knows the league",
    description:
      "Flaim brings your actual roster, scoring rules, league size, and positional depth into the answer. You get more than a generic list of player rankings.",
    ingredients: ["Your roster", "Scoring rules", "League size"],
    media: "future",
  },
  {
    id: "waiver-tuesday",
    label: "Waiver Tuesday",
    question: "Who can actually help my team?",
    title: "Waiver advice from players you can add",
    description:
      "Start with your roster needs and the players still available in your league. Then compare the best additions without typing out your team.",
    ingredients: ["Roster needs", "Available players", "Recent moves"],
    media: "future",
  },
  {
    id: "weekly-matchup",
    label: "Weekly matchup",
    question: "What could decide this week?",
    title: "Start or sit help for your actual opponent",
    description:
      "Your lineup, opponent, scoring rules, and matchup stay together, so the answer can focus on the decisions that matter this week.",
    ingredients: ["Your lineup", "Your opponent", "League scoring"],
    media: "future",
  },
  {
    id: "playoff-push",
    label: "Playoff push",
    question: "What does my path to the playoffs look like?",
    title: "See where your team stands across the league",
    description:
      "Use standings, upcoming matchups, recent moves, and league history to understand what needs to go right down the stretch.",
    ingredients: ["Standings", "Upcoming matchups", "League history"],
    media: "standings",
  },
] as const;

const CROSSOUT_TASKS = [
  "Roster screenshots",
  "Copying and pasting players",
  "Retyping your whole roster",
  "Explaining your league rules",
  "Reminding AI about your team",
  "Starting over every week",
] as const;

type SeasonMoment = (typeof SEASON_MOMENTS)[number];

function IngredientPills({ ingredients }: { ingredients: readonly string[] }) {
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      {ingredients.map((ingredient) => (
        <span
          key={ingredient}
          className="rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground"
        >
          {ingredient}
        </span>
      ))}
    </div>
  );
}

function FutureClip({ moment }: { moment: SeasonMoment }) {
  return (
    <div className="relative flex aspect-[16/11] overflow-hidden rounded-[2rem] border bg-gradient-to-br from-primary/10 via-background to-muted p-6 shadow-sm">
      <div className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-full border bg-background/80 shadow-sm backdrop-blur">
        <CirclePlay className="h-5 w-5 text-primary" aria-hidden="true" />
      </div>
      <div className="mt-auto max-w-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Future phone clip
        </p>
        <p className="mt-2 text-lg font-semibold">{moment.label} in action</p>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          An 8 to 12 second sanitized recording can replace this staging
          placeholder once real 2026 league data is available.
        </p>
      </div>
    </div>
  );
}

function StandingsProof() {
  return (
    <figure className="overflow-hidden rounded-[2rem] border bg-card shadow-sm">
      <div className="relative aspect-[16/10] bg-muted">
        <Image
          src="/media/football/claude-football-standings-2026.png"
          alt="Claude using Flaim to retrieve standings from a connected fantasy football league."
          fill
          sizes="(min-width: 1024px) 46vw, (min-width: 640px) 80vw, 94vw"
          className="object-contain"
        />
      </div>
      <figcaption className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Real connected answer
        </p>
        <p className="mt-2 font-semibold">
          Claude checking an actual football league
        </p>
      </figcaption>
    </figure>
  );
}

function MomentMedia({ moment }: { moment: SeasonMoment }) {
  return moment.media === "standings" ? (
    <StandingsProof />
  ) : (
    <FutureClip moment={moment} />
  );
}

function ConnectedLeaguesProof() {
  return (
    <figure className="mx-auto w-full max-w-md overflow-hidden rounded-[2rem] border bg-card shadow-xl shadow-foreground/5">
      <div className="relative aspect-[4/5] bg-muted/50">
        <Image
          src="/media/football/connected-leagues-widget-2026.png"
          alt="Flaim showing connected ESPN, Yahoo, and Sleeper fantasy football leagues."
          fill
          priority
          sizes="(min-width: 1024px) 36vw, (min-width: 640px) 65vw, 92vw"
          className="object-cover object-top"
        />
      </div>
      <figcaption className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Connect once
        </p>
        <p className="mt-2 font-semibold">
          Your football leagues, ready in one place
        </p>
      </figcaption>
    </figure>
  );
}

function ContrastVariantSwitcher({
  activeVariant,
}: {
  activeVariant: FootballContrastVariantId;
}) {
  return (
    <aside className="border-b border-background/15 pb-7">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-background/55">
        Cross-out lab
      </p>
      <nav
        className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        aria-label="Choose a cross-out treatment"
      >
        {FOOTBALL_CONTRAST_VARIANTS.map((variant) => {
          const isActive = variant.id === activeVariant;

          return (
            <Link
              key={variant.id}
              href={`/fantasy-football?variant=season-chapters&contrast=${variant.id}`}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={`rounded-xl border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background ${
                isActive
                  ? "border-background bg-background text-foreground"
                  : "border-background/20 text-background hover:border-background/50"
              }`}
            >
              <span className="block text-sm font-semibold">
                {variant.label}
              </span>
              <span
                className={`mt-0.5 block text-xs ${
                  isActive ? "text-muted-foreground" : "text-background/55"
                }`}
              >
                {variant.description}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

const CROSSOUT_LAYOUT_CLASSES: Record<
  FootballContrastVariantId,
  { list: string; item: string; text: string }
> = {
  "strike-and-replace": {
    list: "grid overflow-hidden rounded-[2rem] border border-background/15 md:grid-cols-2",
    item: "flex min-h-28 items-center border-b border-background/15 p-6 last:border-b-0 md:odd:border-r md:[&:nth-last-child(-n+2)]:border-b-0 sm:p-7",
    text: "text-base min-[375px]:text-lg sm:text-2xl",
  },
  "coach-marker": {
    list: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
    item: "flex min-h-32 items-center rounded-[1.5rem] border border-background/15 p-6",
    text: "text-base min-[375px]:text-lg sm:text-2xl",
  },
  "x-it-out": {
    list: "grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
    item: "flex min-h-32 items-center justify-center rounded-[1.5rem] border border-background/15 p-6 text-center",
    text: "text-base min-[375px]:text-lg sm:text-2xl",
  },
  "marker-wipe": {
    list: "flex flex-wrap gap-3",
    item: "flex min-h-16 items-center rounded-full border border-background/15 px-5 py-4 sm:px-7",
    text: "text-base min-[375px]:text-lg sm:text-xl",
  },
  "playbook-route": {
    list: "divide-y divide-background/15 border-y border-background/15",
    item: "flex items-center gap-5 py-5 sm:py-6",
    text: "text-base min-[375px]:text-lg sm:text-3xl",
  },
  "fade-and-replace": {
    list: "space-y-1",
    item: "border-b border-background/15 py-5 last:border-b-0 sm:py-6",
    text: "text-lg min-[375px]:text-2xl sm:text-5xl",
  },
};

function CrossOutOnly({
  styleVariant,
}: {
  styleVariant: FootballContrastVariantId;
}) {
  const layout = CROSSOUT_LAYOUT_CLASSES[styleVariant];

  return (
    <FootballStrikeReveal
      className={`football-strike-style-${styleVariant}`}
    >
      <div className="max-w-3xl">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          You can stop doing all of this.
        </h2>
      </div>
      <ul className={`mt-9 ${layout.list}`}>
        {CROSSOUT_TASKS.map((item, index) => (
          <li
            key={item}
            className={layout.item}
            data-football-strike-row={index}
          >
            {styleVariant === "playbook-route" ? (
              <span className="w-8 shrink-0 text-sm font-semibold tabular-nums text-background/35">
                0{index + 1}
              </span>
            ) : null}
            <span
              className={`football-crossout-text relative inline-block w-fit font-semibold tracking-tight text-background/70 ${layout.text}`}
            >
              <span className="football-crossout-copy">{item}</span>
            </span>
          </li>
        ))}
      </ul>
    </FootballStrikeReveal>
  );
}

function LessExplainingSection({
  variant,
  showVariantLab,
}: {
  variant: FootballContrastVariantId;
  showVariantLab: boolean;
}) {
  return (
    <section className="border-b bg-foreground px-4 py-14 text-background sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        {showVariantLab ? (
          <div className="mb-10">
            <ContrastVariantSwitcher activeVariant={variant} />
          </div>
        ) : null}

        <CrossOutOnly styleVariant={variant} />
      </div>
    </section>
  );
}

function SeasonChaptersVariant({
  contrastVariant,
  showContrastVariantLab,
}: {
  contrastVariant: FootballContrastVariantId;
  showContrastVariantLab: boolean;
}) {
  return (
    <>
      <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Your leagues, all season long
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Add your team to your AI
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
              Connect ESPN, Yahoo, or Sleeper to Flaim once. Then, connect Flaim
              to ChatGPT or Claude and you&apos;re done.
            </p>
            <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">
              Ask about the team you drafted, weekly matchups, available
              players, standings, trades, and league history.
            </p>
            <div className="mt-7">
              <FootballConnectionButtons />
            </div>
          </div>
          <ConnectedLeaguesProof />
        </div>
      </section>

      <section className="border-b px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">
              It&apos;s so much nicer this way...
            </h2>
          </div>

          <div className="mt-12 space-y-14 lg:space-y-20">
            {SEASON_MOMENTS.map((moment, index) => (
              <article
                key={moment.id}
                className="grid gap-7 md:grid-cols-2 md:items-center lg:gap-12"
              >
                <div className={index % 2 === 1 ? "md:order-2" : undefined}>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {moment.label}
                  </p>
                  <p className="mt-4 text-sm font-medium text-muted-foreground">
                    &ldquo;{moment.question}&rdquo;
                  </p>
                  <p className="mt-4 leading-7 text-muted-foreground">
                    {moment.description}
                  </p>
                  <IngredientPills ingredients={moment.ingredients} />
                </div>
                <div className={index % 2 === 1 ? "md:order-1" : undefined}>
                  <MomentMedia moment={moment} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <LessExplainingSection
        variant={contrastVariant}
        showVariantLab={showContrastVariantLab}
      />
    </>
  );
}

function QuestionJourneyHero() {
  return (
    <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Ask about the team you actually manage
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Ask one fantasy football question. Bring your whole league.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
            Flaim connects ESPN, Yahoo, or Sleeper to ChatGPT and Claude, so
            every answer can start with your roster, matchup, standings,
            available players, recent moves, and league rules.
          </p>
          <p className="mt-4 leading-7 text-muted-foreground">
            No screenshots. No typing every player. Just ask the question.
          </p>
          <div className="mt-7">
            <FootballConnectionButtons />
          </div>
        </div>

        <div className="rounded-[2rem] border bg-muted/40 p-5 shadow-sm sm:p-7">
          <div className="ml-auto max-w-md rounded-[1.5rem] bg-foreground p-5 text-background">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-background/60">
              You ask
            </p>
            <p className="mt-2 text-lg font-semibold">
              How good is the team I just drafted?
            </p>
          </div>
          <div className="my-4 flex justify-center">
            <ArrowRight
              className="h-5 w-5 rotate-90 text-muted-foreground"
              aria-hidden="true"
            />
          </div>
          <div className="max-w-md rounded-[1.5rem] border bg-background p-5">
            <div className="flex items-center gap-2 text-primary">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                Flaim brings your league
              </p>
            </div>
            <p className="mt-3 leading-7 text-muted-foreground">
              Your roster, scoring rules, league size, standings, and every
              other team.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function QuestionJourneyVariant() {
  return (
    <>
      <QuestionJourneyHero />

      <section className="border-b bg-muted/35 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              The questions change with the season
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              See what goes into each answer
            </h2>
          </div>

          <div className="mt-12 space-y-14 lg:space-y-20">
            {SEASON_MOMENTS.map((moment, index) => (
              <article
                key={moment.id}
                className="grid gap-7 md:grid-cols-2 md:items-center lg:gap-12"
              >
                <div className={index % 2 === 1 ? "md:order-2" : undefined}>
                  <div className="rounded-[1.5rem] bg-foreground p-5 text-background shadow-sm">
                    <div className="flex items-center gap-2 text-background/65">
                      <MessageCircleQuestion
                        className="h-5 w-5"
                        aria-hidden="true"
                      />
                      <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                        {moment.label}
                      </p>
                    </div>
                    <p className="mt-3 text-xl font-semibold">
                      &ldquo;{moment.question}&rdquo;
                    </p>
                  </div>

                  <div className="mt-4 rounded-[1.5rem] border border-primary/25 bg-primary/5 p-5">
                    <div className="flex items-center gap-2 text-primary">
                      <Search className="h-5 w-5" aria-hidden="true" />
                      <p className="text-xs font-semibold uppercase tracking-[0.14em]">
                        Flaim brings
                      </p>
                    </div>
                    <IngredientPills ingredients={moment.ingredients} />
                  </div>

                  <h3 className="mt-6 text-3xl font-bold tracking-tight">
                    {moment.title}
                  </h3>
                  <p className="mt-4 leading-7 text-muted-foreground">
                    {moment.description}
                  </p>
                </div>
                <div className={index % 2 === 1 ? "md:order-1" : undefined}>
                  <MomentMedia moment={moment} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function TimelineHero() {
  return (
    <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1fr_0.8fr] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Draft night through the playoff push
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Keep your real fantasy football league connected all season
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
            Ask ChatGPT or Claude about the next decision without explaining
            your ESPN, Yahoo, or Sleeper league again.
          </p>
          <div className="mt-7">
            <FootballConnectionButtons />
          </div>
        </div>

        <div className="rounded-[2rem] border bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <CalendarDays className="h-6 w-6 text-primary" aria-hidden="true" />
            <p className="font-semibold">One connection for the whole season</p>
          </div>
          <ol className="mt-6 space-y-4">
            {SEASON_MOMENTS.map((moment, index) => (
              <li key={moment.id} className="flex items-center gap-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {moment.label}
                  </p>
                  <p className="mt-1 text-sm font-medium">{moment.question}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function SeasonTimelineVariant() {
  return (
    <>
      <TimelineHero />

      <section className="border-b bg-muted/35 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              A season in four moments
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Your questions move forward. Your league stays with you.
            </h2>
          </div>

          <div className="relative mt-14 space-y-14 md:space-y-20">
            <div
              className="absolute bottom-0 left-1/2 top-0 hidden w-px -translate-x-1/2 bg-border md:block"
              aria-hidden="true"
            />

            {SEASON_MOMENTS.map((moment, index) => {
              const textFirst = index % 2 === 0;

              return (
                <article
                  key={moment.id}
                  className="relative grid gap-7 md:grid-cols-2 md:items-center md:gap-14 lg:gap-20"
                >
                  <div
                    className={`absolute left-1/2 top-1/2 z-10 hidden h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-sm font-bold shadow-sm md:flex ${
                      textFirst ? "text-primary" : "text-foreground"
                    }`}
                    aria-hidden="true"
                  >
                    {index + 1}
                  </div>

                  <div className={textFirst ? undefined : "md:order-2"}>
                    <div className="rounded-[1.75rem] border bg-background p-6 shadow-sm">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                        {moment.label}
                      </p>
                      <p className="mt-4 text-sm font-medium text-muted-foreground">
                        &ldquo;{moment.question}&rdquo;
                      </p>
                      <h3 className="mt-3 text-2xl font-bold tracking-tight">
                        {moment.title}
                      </h3>
                      <p className="mt-4 leading-7 text-muted-foreground">
                        {moment.description}
                      </p>
                      <IngredientPills ingredients={moment.ingredients} />
                    </div>
                  </div>

                  <div className={textFirst ? undefined : "md:order-1"}>
                    <MomentMedia moment={moment} />
                  </div>
                </article>
              );
            })}
          </div>

          <div className="mx-auto mt-14 max-w-2xl rounded-[2rem] border bg-background p-7 text-center shadow-sm">
            <Trophy className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
            <h2 className="mt-5 text-2xl font-bold tracking-tight">
              More than a draft grade
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              Use the same connection for waivers, start or sit calls, trades,
              weekly matchups, standings, recent moves, and league history.
            </p>
            <Link
              href="/#live-demo"
              className="mt-5 inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              Explore the live demo
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

export function FootballSeasonalVariant({
  variant,
  contrastVariant,
  showContrastVariantLab,
}: {
  variant: FootballVariantId;
  contrastVariant: FootballContrastVariantId;
  showContrastVariantLab: boolean;
}) {
  if (variant === "question-journey") {
    return <QuestionJourneyVariant />;
  }

  if (variant === "season-timeline") {
    return <SeasonTimelineVariant />;
  }

  return (
    <SeasonChaptersVariant
      contrastVariant={contrastVariant}
      showContrastVariantLab={showContrastVariantLab}
    />
  );
}
