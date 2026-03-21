import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'How to Connect Your Fantasy League to AI | Flaim',
  description:
    'Connect your ESPN, Yahoo, or Sleeper fantasy leagues to Claude, ChatGPT, or Gemini using Flaim. Setup takes about 5 minutes.',
  alternates: {
    canonical: 'https://flaim.app/guide',
  },
};

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">How to Connect Your Fantasy League to AI</h1>
        <p className="text-muted-foreground mb-8">
          You can connect your ESPN, Yahoo, or Sleeper fantasy leagues to Claude, ChatGPT, or Gemini using Flaim. Setup takes about 5 minutes. Once connected, your AI assistant can access your real league data — rosters, standings, matchups, free agents, and transactions — all read-only.
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
                Clean OAuth flow — no extension needed. Yahoo auto-discovers all your active leagues. Supports football, baseball, basketball, and hockey.
              </p>
            </Link>
            <Link href="/guide/sleeper" className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors">
              <h3 className="font-semibold">Sleeper</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Just your username — no extension, no OAuth to Sleeper. Currently supports football and basketball.
              </p>
            </Link>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Connect your AI assistant</h2>
          <p className="text-muted-foreground mb-4">
            After connecting your fantasy platform, add Flaim as an MCP server in your AI assistant using this URL:
          </p>
          <div className="rounded-lg border bg-muted p-3 mb-4">
            <code className="text-sm">https://api.flaim.app/mcp</code>
          </div>
          <p className="text-muted-foreground mb-4">
            Complete the OAuth authorization screen when prompted. Setup varies by assistant:
          </p>
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Claude</span> — Add Flaim as a remote MCP server in your Claude settings.{' '}
              <a href="https://support.anthropic.com/en/articles/11175166-how-can-i-use-integrations-connectors-in-claude" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Anthropic&apos;s connector docs</a>
            </li>
            <li>
              <span className="font-medium text-foreground">ChatGPT</span> — Add an MCP connection in ChatGPT settings.{' '}
              <a href="https://platform.openai.com/docs/guides/tools/mcp" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">OpenAI&apos;s MCP docs</a>
            </li>
            <li>
              <span className="font-medium text-foreground">Gemini CLI</span> — Run:{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">gemini mcp add flaim https://api.flaim.app/mcp --transport http</code>{' '}
              then <code className="text-xs bg-muted px-1 py-0.5 rounded">/mcp auth flaim</code>
            </li>
          </ul>
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
            Flaim sits between your fantasy platform and your AI assistant. It gives your AI read-only tools to pull your league data — rosters, standings, matchups, free agents, and transactions. Nothing is changed in your league. Flaim cannot trade, drop, or modify anything on your behalf.
          </p>
        </section>
      </div>
    </div>
  );
}
