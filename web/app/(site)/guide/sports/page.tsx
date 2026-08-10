import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fantasy Sports Analysis: How Flaim Works",
  description:
    "See which fantasy sports Flaim supports and the roster, matchup, standings, waiver, and league info it can share with your AI.",
  alternates: {
    canonical: "https://flaim.app/guide/sports",
  },
};

export default function SportsGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            dateModified: "2026-08-09",
            mainEntity: [
              {
                "@type": "Question",
                name: "What sports does Flaim support?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Flaim supports football, baseball, basketball, and hockey on ESPN and Yahoo. Sleeper supports football and basketball.",
                },
              },
              {
                "@type": "Question",
                name: "What can Flaim analyze in my fantasy league?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "Flaim gives your AI read-only access to rosters, standings, matchups, free agents, transactions, player details, league settings, and league history. It also helps your AI use that information when answering fantasy questions.",
                },
              },
              {
                "@type": "Question",
                name: "How does the Flaim Skill work?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "The Flaim Skill helps your AI think like a fantasy analyst. It knows how to evaluate rosters, spot weaknesses, combine your league info with current news, and find the details needed to answer your question.",
                },
              },
            ],
          }),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">Fantasy Sports Analysis</h1>
        <p className="mb-4 text-lg font-medium text-foreground">
          Flaim supports football, baseball, basketball, and hockey on ESPN and
          Yahoo, plus football and basketball on Sleeper. Everything is read-only.
        </p>
        <p className="text-xs text-muted-foreground">Last updated August 2026</p>
        <p className="mt-4 mb-8 text-muted-foreground">
          Flaim gives ChatGPT and Claude your roster, standings, matchups,
          available players, recent moves, and league rules, so the answer can
          reflect your actual team and league.
        </p>

        {/* The Flaim Skill */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">
            How Flaim improves the answer
          </h2>
          <p className="mb-4 text-muted-foreground">
            Flaim does more than send over a list of players. It helps your AI
            use your real league information like a fantasy analyst would.
          </p>
          <div className="space-y-4">
            <div className="rounded-lg border bg-background p-4">
              <h3 className="mb-1 font-medium">Understands your league</h3>
              <p className="text-sm text-muted-foreground">
                Your AI considers which positions matter in your format, where
                your team is weak, and how your scoring rules change player
                value. The answer is based on your actual league, not generic
                rankings.
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <h3 className="mb-1 font-medium">Checks the latest news</h3>
              <p className="text-sm text-muted-foreground">
                Your AI can combine your league info with injury reports,
                recent performance, schedule changes, and breaking news, so the
                answer reflects what is happening now.
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <h3 className="mb-1 font-medium">Pulls together what matters</h3>
              <p className="text-sm text-muted-foreground">
                Ask &ldquo;What is the biggest hole in my roster?&rdquo; and your
                AI can inspect your team, check the players available in your
                league, look up player details, and review current news without
                making you gather everything yourself.
              </p>
            </div>
          </div>
        </section>

        {/* Tools */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What Flaim can see</h2>
          <p className="mb-4 text-muted-foreground">
            Flaim can share these 10 parts of your connected league with your
            AI. They work the same way across all supported sports:
          </p>
          <div className="grid gap-2">
            {[
              {
                name: "Roster",
                desc: "Your team and your opponents' teams, including starters, bench, and injured reserve.",
              },
              {
                name: "Standings",
                desc: "Current league standings with records, points, and rankings.",
              },
              {
                name: "Matchups",
                desc: "Current and upcoming head-to-head matchups with scores and projections.",
              },
              {
                name: "Free Agents",
                desc: "Available players on the waiver wire, filterable by position.",
              },
              {
                name: "Transactions",
                desc: "Recent adds, drops, trades, and waiver claims across the league.",
              },
              {
                name: "Player Lookup",
                desc: "Detailed info on specific players, including stats and availability.",
              },
              {
                name: "League Info",
                desc: "League settings like format, roster slots, scoring rules, and playoff structure.",
              },
              {
                name: "League History",
                desc: "Past season results, standings, and outcomes.",
              },
              {
                name: "Leagues",
                desc: "All connected leagues across platforms, with your defaults and preferences.",
              },
              {
                name: "Refresh Leagues",
                desc: "Updates Flaim's list of your connected leagues so new seasons and renamed leagues show up.",
              },
            ].map(({ name, desc }) => (
              <div
                key={name}
                className="flex gap-3 rounded-lg border bg-background p-3"
              >
                <span className="shrink-0 font-medium">{name}</span>
                <span className="text-sm text-muted-foreground">{desc}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            The first nine only read your league info. Refresh Leagues updates
            Flaim&apos;s own list of connected leagues. Flaim cannot make trades,
            drop players, or change anything in your leagues.
          </p>
        </section>

        {/* Football */}
        <section id="football" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Football</h2>
          <p className="mb-4 text-muted-foreground">
            Football is available on{" "}
            <Link
              href="/guide/platforms#espn"
              className="text-primary hover:underline"
            >
              ESPN
            </Link>
            ,{" "}
            <Link
              href="/guide/platforms#yahoo"
              className="text-primary hover:underline"
            >
              Yahoo
            </Link>
            , and{" "}
            <Link
              href="/guide/platforms#sleeper"
              className="text-primary hover:underline"
            >
              Sleeper
            </Link>
            . Head-to-head matchups, waiver wire strategy, and bye week
            management are where Flaim shines most. The weekly cadence of
            football makes roster decisions high-stakes, and Flaim helps your AI
            reason through them with your actual lineup and scoring rules.
          </p>
          <p className="mb-4 text-sm text-muted-foreground">
            For draft grades, roster analysis, waivers, trades, and weekly
            decisions, see the{" "}
            <Link href="/fantasy-football" className="text-primary hover:underline">
              fantasy football analysis guide
            </Link>
            .
          </p>
          <div className="rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Example prompts</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>&ldquo;Who should I start this week?&rdquo;</li>
              <li>
                &ldquo;Who is the best available running back on my waiver
                wire?&rdquo;
              </li>
              <li>
                &ldquo;What players on my roster have a bye next week?&rdquo;
              </li>
              <li>&ldquo;Am I favored in my matchup this week?&rdquo;</li>
              <li>
                &ldquo;What trades have happened in my league recently?&rdquo;
              </li>
            </ul>
          </div>
        </section>

        {/* Baseball */}
        <section id="baseball" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Baseball</h2>
          <p className="mb-4 text-muted-foreground">
            Baseball is available on{" "}
            <Link
              href="/guide/platforms#espn"
              className="text-primary hover:underline"
            >
              ESPN
            </Link>{" "}
            and{" "}
            <Link
              href="/guide/platforms#yahoo"
              className="text-primary hover:underline"
            >
              Yahoo
            </Link>
            . The daily roster churn, streaming pitchers, and category-based
            scoring make baseball leagues information-dense. Flaim helps your AI
            cut through the noise by focusing on your league&apos;s specific
            categories and your roster&apos;s actual strengths and weaknesses.
          </p>
          <div className="rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Example prompts</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>&ldquo;What categories am I weakest in this week?&rdquo;</li>
              <li>
                &ldquo;Who is the best available pitcher on the wire?&rdquo;
              </li>
              <li>
                &ldquo;Show me my roster and tell me who is
                underperforming.&rdquo;
              </li>
              <li>&ldquo;What are the latest moves in my league?&rdquo;</li>
              <li>&ldquo;Who should I be selling high on?&rdquo;</li>
            </ul>
          </div>
        </section>

        {/* Basketball */}
        <section id="basketball" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Basketball</h2>
          <p className="mb-4 text-muted-foreground">
            Basketball is available on{" "}
            <Link
              href="/guide/platforms#espn"
              className="text-primary hover:underline"
            >
              ESPN
            </Link>
            ,{" "}
            <Link
              href="/guide/platforms#yahoo"
              className="text-primary hover:underline"
            >
              Yahoo
            </Link>
            , and{" "}
            <Link
              href="/guide/platforms#sleeper"
              className="text-primary hover:underline"
            >
              Sleeper
            </Link>
            . The long season and multi-game weeks create a steady stream of
            roster decisions. Flaim helps your AI track standings, evaluate
            trades, and find waiver targets based on your league&apos;s format.
          </p>
          <div className="rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Example prompts</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>&ldquo;What are my league standings right now?&rdquo;</li>
              <li>&ldquo;Who is the best available point guard?&rdquo;</li>
              <li>
                &ldquo;What player on my roster should I give up on?&rdquo;
              </li>
            </ul>
          </div>
        </section>

        {/* Hockey */}
        <section id="hockey" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Hockey</h2>
          <p className="mb-4 text-muted-foreground">
            Hockey is available on{" "}
            <Link
              href="/guide/platforms#espn"
              className="text-primary hover:underline"
            >
              ESPN
            </Link>{" "}
            and{" "}
            <Link
              href="/guide/platforms#yahoo"
              className="text-primary hover:underline"
            >
              Yahoo
            </Link>
            . Flaim gives your AI access to rosters, standings, matchups, and
            transactions for hockey leagues. The same roster and league details
            that power football and baseball analysis work here, using your
            league&apos;s scoring and format.
          </p>
          <div className="rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Example prompts</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                &ldquo;Show me my roster and who is on injured reserve.&rdquo;
              </li>
              <li>&ldquo;Who is winning my league and why?&rdquo;</li>
              <li>&ldquo;What are the biggest holes on my team?&rdquo;</li>
              <li>&ldquo;What moves happened in my league this week?&rdquo;</li>
            </ul>
          </div>
        </section>

        {/* Platform coverage matrix */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Platform coverage</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            See the{" "}
            <Link
              href="/guide/platforms"
              className="text-primary hover:underline"
            >
              fantasy platform help
            </Link>{" "}
            for connection instructions.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="pb-2 pr-4 text-left font-medium">Sport</th>
                  <th className="pb-2 px-4 text-center font-medium">ESPN</th>
                  <th className="pb-2 px-4 text-center font-medium">Yahoo</th>
                  <th className="pb-2 pl-4 text-center font-medium">Sleeper</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b">
                  <td className="py-2 pr-4">Football</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 pl-4 text-center">Yes</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4">Baseball</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 pl-4 text-center">No</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-4">Basketball</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 pl-4 text-center">Yes</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4">Hockey</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 px-4 text-center">Yes</td>
                  <td className="py-2 pl-4 text-center">No</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="flex items-center gap-4 border-t pt-4 text-sm">
          <Link
            href="/guide/platforms"
            className="text-primary hover:underline"
          >
            &larr; Platform setup
          </Link>
          <Link href="/guide/ai" className="text-primary hover:underline">
            AI setup &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
