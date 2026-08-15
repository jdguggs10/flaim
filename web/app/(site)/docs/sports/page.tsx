import type { Metadata } from "next";
import Link from "next/link";
import { Check, ChevronDown, Minus, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Supported Fantasy Sports and League Data",
  description:
    "See Flaim's ESPN, Yahoo, and Sleeper sport coverage and the roster, matchup, standings, available player, transaction, and league history information it can give your AI.",
  alternates: {
    canonical: "https://flaim.app/docs/sports",
  },
  openGraph: {
    title: "Supported Fantasy Sports and League Data | Flaim Fantasy",
    description:
      "See which fantasy sports Flaim supports and what league information ChatGPT and Claude can use.",
    url: "https://flaim.app/docs/sports",
  },
};

const COVERAGE = [
  { sport: "Football", espn: true, yahoo: true, sleeper: true },
  { sport: "Baseball", espn: true, yahoo: true, sleeper: false },
  { sport: "Basketball", espn: true, yahoo: true, sleeper: true },
  { sport: "Hockey", espn: true, yahoo: true, sleeper: false },
] as const;

const LEAGUE_INFORMATION = [
  {
    name: "Your leagues",
    description:
      "Your active leagues across ESPN, Yahoo, and Sleeper, including the team and default league you have chosen for each sport.",
  },
  {
    name: "League rules",
    description:
      "Scoring, roster slots, teams, owners, schedule details, and other settings supplied by your fantasy platform.",
  },
  {
    name: "Rosters",
    description:
      "Your roster and other teams in the league, including lineup positions and historical snapshots where available.",
  },
  {
    name: "Matchups",
    description:
      "Current or selected matchups, scores, opponents, and projections when the fantasy platform provides them.",
  },
  {
    name: "Standings and results",
    description:
      "League standings, records, rankings, points, playoff status, and verified season results when available.",
  },
  {
    name: "Available players",
    description:
      "Players who are available in your league, with position and ownership information when the platform provides it.",
  },
  {
    name: "Player search",
    description:
      "Player identity, team, position, and roster or ownership information when the platform can supply it.",
  },
  {
    name: "Recent league moves",
    description:
      "Adds, drops, waiver activity, and trades from the recent window supplied by your fantasy platform.",
  },
  {
    name: "Past seasons",
    description:
      "Historical leagues and seasons, followed by the available standings, results, rosters, and other league information for the season you choose.",
  },
] as const;

const PLATFORM_DIFFERENCES = [
  {
    title: "Available players and ownership",
    body: "ESPN and Yahoo can provide platform-wide player ownership rates. Sleeper does not provide ownership rates. ESPN can also distinguish a free agent from a player on waivers when that information is available. Yahoo and Sleeper confirm that a player is available without always making that distinction.",
  },
  {
    title: "Historical rosters",
    body: "Football roster history uses a matchup week on ESPN, Yahoo, and Sleeper. Sleeper basketball also uses a matchup week. ESPN and Yahoo baseball, basketball, and hockey use a calendar date because those rosters can change daily. Some older snapshots contain less lineup detail than a current roster.",
  },
  {
    title: "Recent league moves",
    body: "The amount and type of transaction history depends on the platform. ESPN and Sleeper organize activity around matchup periods or weeks, while Yahoo supplies a recent 14-day window. ESPN can also show FAAB bid amounts, failed waiver claims, and trade proposals, rejections, and vetoes. Yahoo and Sleeper show completed adds, drops, waivers, and trades, and Yahoo can add your own team's pending waiver claims and trade offers.",
  },
] as const;

const SPORTS = [
  {
    id: "football",
    name: "Fantasy football",
    platforms: ["ESPN", "Yahoo", "Sleeper"],
    body: "Use your league rules, roster, matchup, standings, available players, and recent moves for draft grades, start or sit decisions, waiver ideas, trades, and season reviews.",
    href: "/fantasy-football",
    linkLabel: "See fantasy football examples",
  },
  {
    id: "baseball",
    name: "Fantasy baseball",
    platforms: ["ESPN", "Yahoo"],
    body: "Use your categories, daily roster, matchup, standings, available players, and recent moves for streaming, waiver, trade, and category analysis.",
  },
  {
    id: "basketball",
    name: "Fantasy basketball",
    platforms: ["ESPN", "Yahoo", "Sleeper"],
    body: "Use your scoring format, roster, matchup, standings, available players, and recent moves for weekly decisions, waiver targets, and trades.",
  },
  {
    id: "hockey",
    name: "Fantasy hockey",
    platforms: ["ESPN", "Yahoo"],
    body: "Use your scoring format, roster, matchup, standings, available players, and recent moves to understand your team and league.",
  },
] as const;

const FAQS = [
  {
    question: "Which fantasy sports and platforms does Flaim support?",
    answer:
      "Flaim supports fantasy football, baseball, basketball, and hockey on ESPN and Yahoo. It supports fantasy football and basketball on Sleeper.",
  },
  {
    question: "What league information can Flaim use?",
    answer:
      "Flaim can give your AI your connected leagues, league rules, rosters, matchups, standings, available players, player information, recent moves, and past seasons. Exact fields depend on the sport and fantasy platform.",
  },
  {
    question: "Can Flaim work across several leagues and platforms?",
    answer:
      "Yes. One Flaim account can hold multiple supported leagues from ESPN, Yahoo, and Sleeper. You can choose default leagues for quick questions or ask your AI to compare specific leagues.",
  },
  {
    question: "Can Flaim use past fantasy seasons?",
    answer:
      "Yes. Flaim can find historical leagues and seasons, then load the standings, results, rosters, and other information available for the season you choose.",
  },
  {
    question: "Does every fantasy platform return the same information?",
    answer:
      "No. The main league information is available across every supported platform and sport, but ownership rates, historical roster details, projections, and recent transaction windows can differ between ESPN, Yahoo, and Sleeper.",
  },
  {
    question: "Can Flaim change my lineup or make trades?",
    answer:
      "No. Flaim's league analysis is read-only. It cannot edit lineups, add or drop players, submit waiver claims or trades, or change league settings. Refresh only updates Flaim's own list of connected leagues.",
  },
] as const;

function CoverageStatus({ supported }: { supported: boolean }) {
  return supported ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
      <Check className="h-4 w-4 text-primary" aria-hidden="true" />
      <span className="hidden sm:inline">Supported</span>
      <span className="sr-only sm:hidden">Supported</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Minus className="h-4 w-4" aria-hidden="true" />
      <span className="hidden sm:inline">Not available</span>
      <span className="sr-only sm:hidden">Not available</span>
    </span>
  );
}

export default function SportsGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            dateModified: "2026-08-15",
            mainEntity: FAQS.map((faq) => ({
              "@type": "Question",
              name: faq.question,
              acceptedAnswer: {
                "@type": "Answer",
                text: faq.answer,
              },
            })),
          }),
        }}
      />

      <section className="border-b px-4 py-16 sm:px-6 md:py-20 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            After setup
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
            Fantasy sports and league coverage
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
            Flaim supports fantasy football, baseball, basketball, and hockey
            on ESPN and Yahoo, plus football and basketball on Sleeper. See
            exactly what league information ChatGPT and Claude can use.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/leagues">Open Your Leagues</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/docs">Back to Docs</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Supported sports
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            ESPN, Yahoo, and Sleeper
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            ESPN and Yahoo support all four sports. Sleeper supports football
            and basketball. See{" "}
            <Link
              href="/docs/platforms"
              className="font-medium text-primary hover:underline"
            >
              Fantasy Platform Docs
            </Link>{" "}
            for connection instructions.
          </p>

          <div className="mt-8 overflow-hidden rounded-2xl border">
            <div>
              <table className="w-full table-fixed text-xs sm:table-auto sm:text-sm">
                <caption className="sr-only">
                  Fantasy sport support by ESPN, Yahoo, and Sleeper
                </caption>
                <thead className="bg-muted/60">
                  <tr>
                    <th className="w-[28%] px-3 py-4 text-left font-semibold sm:w-auto sm:px-5">
                      Sport
                    </th>
                    <th className="px-2 py-4 text-center font-semibold sm:px-5 sm:text-left">
                      ESPN
                    </th>
                    <th className="px-2 py-4 text-center font-semibold sm:px-5 sm:text-left">
                      Yahoo
                    </th>
                    <th className="px-2 py-4 text-center font-semibold sm:px-5 sm:text-left">
                      Sleeper
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COVERAGE.map((row) => (
                    <tr key={row.sport} className="border-t">
                      <th
                        className="px-3 py-4 text-left font-medium sm:px-5"
                        scope="row"
                      >
                        {row.sport}
                      </th>
                      <td className="px-2 py-4 text-center sm:px-5 sm:text-left">
                        <CoverageStatus supported={row.espn} />
                      </td>
                      <td className="px-2 py-4 text-center sm:px-5 sm:text-left">
                        <CoverageStatus supported={row.yahoo} />
                      </td>
                      <td className="px-2 py-4 text-center sm:px-5 sm:text-left">
                        <CoverageStatus supported={row.sleeper} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Your actual league
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            What Flaim can use
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Flaim identifies the league you mean, loads its rules and teams,
            then gets the roster, matchup, standings, players, or league moves
            needed for your question. Your AI analyzes that information. If
            current injuries or news matter, the AI app can check the web
            separately when it supports web search.
          </p>

          <div className="mt-8 grid overflow-hidden rounded-2xl border bg-background md:grid-cols-2">
            {LEAGUE_INFORMATION.map((item, index) => (
              <article
                key={item.name}
                className={[
                  "p-5",
                  index > 0 ? "border-t" : "",
                  index === 1 ? "md:border-t-0" : "",
                  index % 2 === 1 ? "md:border-l" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <h3 className="font-semibold">{item.name}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {item.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Platform differences
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            The details are not always identical
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Flaim can read the same main parts of a league across supported
            platforms. ESPN, Yahoo, and Sleeper do not always return those
            details in the same way.
          </p>
          <div className="mt-8 space-y-3">
            {PLATFORM_DIFFERENCES.map((item) => (
              <details key={item.title} className="group rounded-xl border">
                <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 font-medium">
                  {item.title}
                  <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 text-sm leading-6 text-muted-foreground">
                  {item.body}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            By sport
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Football, baseball, basketball, and hockey
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            {SPORTS.map((sport) => (
              <article
                id={sport.id}
                key={sport.id}
                className="scroll-mt-24 rounded-2xl border bg-background p-6"
              >
                <h3 className="text-2xl font-semibold">{sport.name}</h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {sport.platforms.map((platform) => (
                    <span
                      key={platform}
                      className="rounded-full border px-3 py-1 text-xs font-medium"
                    >
                      {platform}
                    </span>
                  ))}
                </div>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  {sport.body}
                </p>
                {"href" in sport ? (
                  <Link
                    href={sport.href}
                    className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
                  >
                    {sport.linkLabel}
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="rounded-2xl border p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="rounded-full bg-primary/10 p-2 text-primary">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Read-only</h2>
                <p className="mt-3 leading-7 text-muted-foreground">
                  Flaim cannot edit lineups, add or drop players, submit waiver
                  claims or trades, or change league settings. Refresh Leagues
                  only updates Flaim&apos;s own list of connected leagues so new
                  seasons and renamed leagues can appear.
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  When your AI asks for league information, Flaim requests the
                  latest available data from the fantasy platform. Past seasons
                  stay separate from your active, current-season leagues.
                </p>
              </div>
            </div>
          </div>

          <h2 className="mt-16 text-3xl font-bold tracking-tight">
            Sports and league FAQs
          </h2>
          <div className="mt-6 space-y-3">
            {FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border">
                <summary className="flex cursor-pointer items-center justify-between gap-4 p-5 font-medium">
                  {faq.question}
                  <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-5 pb-5 text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>

          <nav
            aria-label="Sports docs navigation"
            className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <Button
              asChild
              size="lg"
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Link href="/docs">Back to Docs</Link>
            </Button>
            <Button asChild size="lg" className="w-full sm:w-auto">
              <Link href="/leagues">Open Your Leagues</Link>
            </Button>
          </nav>
        </div>
      </section>
    </div>
  );
}
