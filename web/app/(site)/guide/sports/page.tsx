import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fantasy Sports Analysis: How Flaim Works",
  description:
    "How the Flaim Skill teaches your AI to analyze fantasy sports. Tools, example prompts, and sport-specific coverage for football, baseball, basketball, and hockey.",
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
            dateModified: "2026-03-28",
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
                  text: "Flaim gives your AI read-only access to rosters, standings, matchups, free agents, transactions, player details, league settings, and league history. The Flaim Skill teaches your AI how to reason about fantasy strategy using these tools.",
                },
              },
              {
                "@type": "Question",
                name: "How does the Flaim Skill work?",
                acceptedAnswer: {
                  "@type": "Answer",
                  text: "The Flaim Skill is a set of instructions that teach your AI to think like a fantasy analyst. It knows how to evaluate rosters, spot weaknesses, combine league data with live web context, and decide which tools to call and in what order based on your question.",
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
          Yahoo, plus football and basketball on Sleeper — all read-only.
        </p>
        <p className="text-xs text-muted-foreground">Last updated March 2026</p>
        <p className="mt-4 mb-8 text-muted-foreground">
          Flaim is more than a data connection. It teaches your AI how to think
          about fantasy sports through the Flaim Skill and a set of read-only
          tools that work across ESPN, Yahoo, and Sleeper.
        </p>

        {/* The Flaim Skill */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">The Flaim Skill</h2>
          <p className="mb-4 text-muted-foreground">
            When you connect Flaim to your AI assistant, it does not just expose
            raw data. The Flaim Skill is a set of instructions that shape how
            your AI reasons about fantasy sports. It covers three areas:
          </p>
          <div className="space-y-4">
            <div className="rounded-lg border bg-background p-4">
              <h3 className="mb-1 font-medium">Fantasy analyst reasoning</h3>
              <p className="text-sm text-muted-foreground">
                Your AI learns how to evaluate rosters in context: what
                positions matter most in your league format, where your team is
                weak, and how your scoring settings change player value. Instead
                of generic fantasy advice, Flaim grounds every answer in your
                actual league&apos;s rules and standings.
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <h3 className="mb-1 font-medium">Web search when it matters</h3>
              <p className="text-sm text-muted-foreground">
                Your AI knows when to reach beyond your league data for current
                context. Injury reports, recent performance trends, schedule
                changes, and breaking news get layered on top of your league
                data so the answer reflects what is actually happening right
                now, not just what the box score says.
              </p>
            </div>
            <div className="rounded-lg border bg-background p-4">
              <h3 className="mb-1 font-medium">Smart tool orchestration</h3>
              <p className="text-sm text-muted-foreground">
                One question can pull from multiple tools automatically. Ask
                &ldquo;What is the biggest hole in my roster?&rdquo; and your AI
                inspects your roster, checks the waiver wire, looks up player
                details, and adds web context, all in the right order, without
                you specifying which tools to use.
              </p>
            </div>
          </div>
        </section>

        {/* Tools */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What Flaim can see</h2>
          <p className="mb-4 text-muted-foreground">
            Flaim provides 9 read-only tools that give your AI access to your
            league data. These tools work the same way across all supported
            sports:
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
            All tools are read-only. Flaim cannot make trades, drop players, or
            change anything in your leagues.
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
            reason through them with your actual lineup and scoring context.
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
            transactions for hockey leagues. The same tools and skill that power
            football and baseball analysis work here, grounded in your
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
              platform setup guide
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
            AI assistant setup &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
