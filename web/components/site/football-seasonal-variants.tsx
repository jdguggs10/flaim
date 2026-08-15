import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { FootballStrikeReveal } from "@/components/site/football-strike-reveal";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
} from "@/lib/product-links";

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
    question: "Grade Dart FTW's Week 1 roster.",
    description:
      "Flaim brings your actual roster, scoring rules, league size, and positional depth into the answer. You get more than a generic list of player rankings.",
    ingredients: ["Your roster", "Scoring rules", "League size"],
    imageSrc: "/media/football/chatgpt-draft-grade-20260815-v2.png",
    imageAlt:
      "ChatGPT grading Dart FTW's Week 1 fantasy football roster with Flaim.",
    provider: "ChatGPT",
    proofCaption: "A roster grade grounded in the actual team",
  },
  {
    id: "waiver-tuesday",
    label: "Waiver Tuesday",
    question: "What was Dart FTW's best roster move around Week 11?",
    description:
      "Start with your roster needs and the players still available in your league. Then compare the best additions without typing out your team.",
    ingredients: ["Roster needs", "Available players", "Recent moves"],
    imageSrc: "/media/football/claude-week11-move-20260815.png",
    imageAlt:
      "Claude identifying Dart FTW's best fantasy football roster move around Week 11 with Flaim.",
    provider: "Claude",
    proofCaption: "A roster move explained with league context",
  },
  {
    id: "weekly-matchup",
    label: "Weekly matchup",
    question: "How did Dart FTW win Week 11?",
    description:
      "Your lineup, opponent, scoring rules, and matchup stay together, so the answer can focus on the decisions that matter this week.",
    ingredients: ["Your lineup", "Your opponent", "League scoring"],
    imageSrc: "/media/football/perplexity-week11-matchup-20260815.png",
    imageAlt:
      "Perplexity using Flaim to explain how Dart FTW won its Week 11 fantasy football matchup.",
    provider: "Perplexity",
    proofCaption: "A matchup result pulled from the connected league",
  },
  {
    id: "playoff-push",
    label: "Playoff push",
    question: "What happened to Dart FTW's playoff push?",
    description:
      "Use standings, upcoming matchups, recent moves, and league history to understand what needs to go right down the stretch.",
    ingredients: ["Standings", "Upcoming matchups", "League history"],
    imageSrc: "/media/football/chatgpt-playoff-push-20260815.png",
    imageAlt:
      "ChatGPT using Flaim to explain what happened to Dart FTW's fantasy football playoff push.",
    provider: "ChatGPT",
    proofCaption: "A playoff story reconstructed from the season",
  },
] as const;

const CROSSOUT_TASKS = [
  "Roster screenshots",
  "Copying and pasting players",
  "Retyping your whole roster",
  "Explaining your league rules",
  "Reminding AI about your team",
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

function MomentMedia({ moment }: { moment: SeasonMoment }) {
  return (
    <figure className="mx-auto w-full max-w-[21rem]">
      <div className="overflow-hidden rounded-[2.5rem] border-[6px] border-foreground bg-foreground shadow-xl shadow-foreground/10">
        <div className="relative aspect-[201/437] bg-muted">
          <Image
            src={moment.imageSrc}
            alt={moment.imageAlt}
            fill
            sizes="(min-width: 1024px) 21rem, (min-width: 640px) 42vw, 92vw"
            className="object-cover"
          />
        </div>
      </div>
      <figcaption className="px-4 pt-5 text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          {moment.provider}, powered by Flaim
        </p>
        <p className="mt-2 text-sm font-semibold">{moment.proofCaption}</p>
      </figcaption>
    </figure>
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

function CrossOutSection() {
  return (
    <FootballStrikeReveal className="football-strike-style-fade-away">
      <div className="max-w-3xl">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          You can stop doing all of this.
        </h2>
      </div>
      <ul className="mt-9 space-y-1">
        {CROSSOUT_TASKS.map((item, index) => (
          <li
            key={item}
            className="border-b border-background/15 py-5 last:border-b-0 sm:py-6"
            data-football-strike-row={index}
          >
            <span className="football-crossout-text relative inline-block w-fit text-lg font-semibold tracking-tight text-background/70 min-[375px]:text-2xl sm:text-5xl">
              <span className="football-crossout-copy">{item}</span>
            </span>
          </li>
        ))}
      </ul>
    </FootballStrikeReveal>
  );
}

function LessExplainingSection() {
  return (
    <section className="border-b bg-foreground px-4 py-14 text-background sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <CrossOutSection />
      </div>
    </section>
  );
}

export function FootballSeasonalPage() {
  return (
    <>
      <section className="border-b px-4 py-12 sm:px-6 md:py-16 lg:px-8">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Your actual fantasy football league
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
              Your Fantasy Football Team + AI
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-muted-foreground">
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

      <LessExplainingSection />

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
    </>
  );
}
