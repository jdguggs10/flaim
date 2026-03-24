import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How to Connect Your Fantasy League to AI | Flaim',
  description:
    'Connect your ESPN, Yahoo, or Sleeper fantasy leagues to Claude, ChatGPT, Gemini, or Perplexity using Flaim. Setup takes about 5 minutes.',
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
                name: 'Connect ESPN Fantasy to AI',
                url: 'https://flaim.app/guide/espn',
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: 'Connect Yahoo Fantasy to AI',
                url: 'https://flaim.app/guide/yahoo',
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: 'Connect Sleeper Fantasy to AI',
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
                name: 'Use Flaim with Gemini',
                url: 'https://flaim.app/guide/gemini',
              },
              {
                '@type': 'ListItem',
                position: 7,
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
          You can connect your ESPN, Yahoo, or Sleeper fantasy leagues to Claude, ChatGPT, or Gemini using Flaim. Setup takes about 5 minutes. Once connected, your AI assistant can access your real league data: rosters, standings, matchups, free agents, and transactions. All read-only.
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
                Add Flaim as a custom connector. Requires a Pro, Max, Team, or Enterprise plan.
              </p>
            </Link>
            <Link href="/guide/chatgpt" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">ChatGPT</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add Flaim as a custom MCP connector. Requires a paid plan (Plus, Pro, Team, Enterprise, or Edu).
              </p>
            </Link>
            <Link href="/guide/gemini" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">Gemini CLI</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add Flaim via the command line. Two commands and you&apos;re connected.
              </p>
            </Link>
            <Link href="/guide/perplexity" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">Perplexity</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Add Flaim as a custom remote connector. Requires a Pro, Max, or Enterprise plan.
              </p>
            </Link>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you can ask</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;Who should I start this week?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Pulls your real matchup and roster</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;Who&rsquo;s on the waiver wire?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Scans available free agents in your league</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;Show me the standings&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Current standings across any of your leagues</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;What trades happened this week?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Recent transactions in your league</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;Who are the best available QBs?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Top free agents by position</p>
            </div>
            <div className="rounded-lg border bg-background p-3">
              <p className="text-sm font-medium">&ldquo;What fantasy leagues do I have?&rdquo;</p>
              <p className="text-xs text-muted-foreground mt-1">Lists all connected leagues across platforms</p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold mb-3">How it works</h2>
          <p className="text-muted-foreground">
            Flaim sits between your fantasy platform and your AI assistant. It gives your AI read-only tools to pull your league data: rosters, standings, matchups, free agents, and transactions. Nothing is changed in your league. Flaim cannot trade, drop, or modify anything on your behalf.
          </p>
        </section>
      </div>
    </div>
  );
}
