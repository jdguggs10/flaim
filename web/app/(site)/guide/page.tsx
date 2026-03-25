import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How to Connect Your Fantasy League to AI | Flaim',
  description:
    'Connect your ESPN, Yahoo, or Sleeper fantasy leagues to Claude, ChatGPT, or Perplexity using Flaim. Setup takes about 5 minutes.',
  alternates: {
    canonical: 'https://flaim.app/guide',
  },
};

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: 'Fantasy League Setup Guides',
            description: 'Step-by-step guides to connect ESPN, Yahoo, or Sleeper fantasy leagues to AI assistants using Flaim.',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: 'Connect ESPN',
                url: 'https://flaim.app/guide/espn',
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: 'Connect Yahoo',
                url: 'https://flaim.app/guide/yahoo',
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: 'Connect Sleeper',
                url: 'https://flaim.app/guide/sleeper',
              },
              {
                '@type': 'ListItem',
                position: 4,
                name: 'Use Flaim with Claude',
                url: 'https://flaim.app/guide/claude',
              },
              {
                '@type': 'ListItem',
                position: 5,
                name: 'Use Flaim with ChatGPT',
                url: 'https://flaim.app/guide/chatgpt',
              },
              {
                '@type': 'ListItem',
                position: 6,
                name: 'Use Flaim with Perplexity',
                url: 'https://flaim.app/guide/perplexity',
              },
            ],
          }),
        }}
      />
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">How to Connect Your Fantasy League to AI</h1>
        <p className="text-muted-foreground mb-8">
          You can connect your ESPN, Yahoo, or Sleeper fantasy leagues to Claude, ChatGPT, or Perplexity using Flaim. Setup takes about 5 minutes. Once connected, your AI assistant can access your real league data: rosters, standings, matchups, free agents, and transactions. All read-only.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-4">Choose your platform</h2>
          <div className="grid gap-3">
            <Link href="/guide/espn" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">ESPN</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Requires the Flaim Chrome extension to sync your league credentials. Supports football, baseball, basketball, and hockey.
              </p>
            </Link>
            <Link href="/guide/yahoo" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">Yahoo</h3>
              <p className="text-sm text-muted-foreground mt-1">
                No extension needed, just sign in with Yahoo. Auto-discovers all your active leagues. Supports football, baseball, basketball, and hockey.
              </p>
            </Link>
            <Link href="/guide/sleeper" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">Sleeper</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Just your username, no extension, no OAuth to Sleeper. Currently supports football and basketball.
              </p>
            </Link>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Connect your AI assistant</h2>
          <p className="text-muted-foreground mb-4">
            After connecting your fantasy platform, add Flaim to your AI assistant. You&apos;ll need this server URL:
          </p>
          <div className="rounded-lg border bg-muted p-3 mb-4">
            <code className="text-sm">https://api.flaim.app/mcp</code>
          </div>
          <p className="text-muted-foreground mb-4">
            You&apos;ll see a Flaim authorization screen. Sign in and approve, then you&apos;re all set. See detailed setup guides for each assistant:
          </p>
          <div className="grid gap-3">
            <Link href="/guide/claude" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">Claude</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add Flaim as a custom connector in Settings. Requires a Pro, Max, Team, or Enterprise plan.
              </p>
            </Link>
            <Link href="/guide/chatgpt" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">ChatGPT</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add Flaim as a custom MCP connector. Requires a paid plan and Developer Mode enabled.
              </p>
            </Link>
            <Link href="/guide/perplexity" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">Perplexity</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add Flaim as a custom remote connector. Requires a Pro, Max, or Enterprise plan.
              </p>
            </Link>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Not available yet: Gemini, Grok.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What Flaim gives your AI</h2>
          <p className="text-muted-foreground mb-4">
            <strong>1 skill</strong> that teaches your AI how to think like a fantasy analyst:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-6">
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">flaim-fantasy</code> — System prompt with league context, analysis patterns, and best practices</li>
          </ul>
          <p className="text-muted-foreground mb-4">
            <strong>9 tools</strong> for pulling your league data:
          </p>
          <ol className="list-decimal list-inside text-sm text-muted-foreground space-y-1 mb-6">
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_user_session</code> — Your leagues, default league, and platform context</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_league_info</code> — Settings, scoring, roster slots, schedule, and teams</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_standings</code> — Records, rankings, and playoff seeds</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_matchups</code> — Scoreboard for any week</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_roster</code> — Players, positions, and stats for any team</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_free_agents</code> — Available players, optionally filtered by position</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_players</code> — Search for any player by name</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_transactions</code> — Recent adds, drops, waivers, and trades</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">get_ancient_history</code> — Past seasons and historical leagues</li>
          </ol>
          <p className="text-muted-foreground mb-4">
            <strong>2 commands</strong> available in Claude:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">/activity-brief</code> — Summarize recent league transactions and explain what happened</li>
            <li><code className="text-xs bg-muted px-1 py-0.5 rounded">/analyze-matchup</code> — Break down your current matchup with scores and forecast</li>
          </ul>
        </section>

      </div>
    </div>
  );
}
