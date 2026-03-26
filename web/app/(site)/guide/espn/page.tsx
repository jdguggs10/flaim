import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Connect ESPN | Flaim',
  description:
    'Connect ESPN to Flaim from /leagues, confirm your leagues synced, and use the manual fallback when the Chrome extension is not enough.',
  alternates: {
    canonical: 'https://flaim.app/guide/espn',
  },
};

export default function EspnGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Connect ESPN',
            description:
              'Connect your ESPN leagues from /leagues, sync with the Chrome extension, and verify the leagues show up before adding Flaim to your AI assistant.',
            step: [
              {
                '@type': 'HowToStep',
                name: 'Open leagues',
                text: 'Sign in to Flaim and open https://flaim.app/leagues.',
              },
              {
                '@type': 'HowToStep',
                name: 'Connect ESPN',
                text: 'Use the ESPN card to sync from the Flaim Chrome extension or use the manual credential fallback.',
              },
              {
                '@type': 'HowToStep',
                name: 'Verify leagues',
                text: 'Confirm that your ESPN leagues appear in /leagues.',
              },
              {
                '@type': 'HowToStep',
                name: 'Add Flaim to your AI assistant',
                text: 'Use the Flaim MCP server URL https://api.flaim.app/mcp in your AI connector flow.',
              },
            ],
          }),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">Connect ESPN</h1>
        <p className="mb-8 text-muted-foreground">
          ESPN is the highest-friction Flaim setup, so the goal is simple: get your ESPN leagues visible in
          <Link href="/leagues" className="text-primary hover:underline"> /leagues</Link> before you bother with AI
          setup. The Chrome extension is the preferred path. Manual cookie entry exists as a fallback when extension sync
          does not work for you.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Sign in to Flaim.</li>
            <li>Use the ESPN account that actually owns or participates in the leagues you want.</li>
            <li>Supported sports are football, baseball, basketball, and hockey.</li>
            <li>Chrome is recommended for the extension path. If you cannot use Chrome, keep reading for the manual fallback.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Do this in /leagues</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and choose ESPN.</li>
            <li>Preferred path: install the Flaim Chrome extension, sign in to fantasy.espn.com in that same browser profile, then trigger Sync from the extension.</li>
            <li>If extension sync is unavailable or fails repeatedly, use the manual credential path in the ESPN card and paste your <code className="rounded bg-muted px-1 py-0.5 text-xs">SWID</code> and <code className="rounded bg-muted px-1 py-0.5 text-xs">ESPN_S2</code> values.</li>
            <li>If Flaim asks for league IDs, add the private leagues you care about and run verification again.</li>
            <li>Wait until your ESPN leagues show up in the page before moving on to AI setup.</li>
            <li>Then add Flaim to Claude, ChatGPT, or Perplexity with <code className="rounded bg-muted px-1 py-0.5 text-xs">https://api.flaim.app/mcp</code>. Start at the <Link href="/guide" className="text-primary hover:underline">guide overview</Link> if you need the AI-specific steps.</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>The ESPN section in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> shows connected leagues, not just a pending state.</li>
            <li>You can identify the league you want to use most often, even if you do not set a default yet.</li>
            <li>A fresh AI chat can answer &ldquo;What leagues do I have?&rdquo; or &ldquo;Show my ESPN leagues&rdquo; without an auth error.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Why the extension is recommended</h2>
          <p className="text-muted-foreground">
            ESPN does not offer a normal public fantasy API for this use case. The extension is the cleanest way for
            Flaim to capture the session details it needs for read-only access. Your ESPN credentials are never shared
            with AI providers.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">If something goes wrong</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Sync succeeds but no leagues show up: make sure you are logged into the correct ESPN account and try the sync again.</li>
            <li>Private league still missing: add the league ID manually from the ESPN flow in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.</li>
            <li>Credentials expire or become invalid later: rerun extension sync or replace the manual cookies.</li>
            <li>You authorized an AI connector before ESPN was linked: finish ESPN first, then start a fresh AI conversation.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What happens next</h2>
          <p className="mb-3 text-muted-foreground">
            Once ESPN is visible in Flaim, the rest is just AI setup and a quick smoke test.
          </p>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Add Flaim to your AI assistant.</li>
            <li>Start a new chat and ask about your roster, matchup, or standings.</li>
            <li>If you use more than one league, narrow your first prompt by league name until you are comfortable with the flow.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Related guides</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li><Link href="/guide/yahoo" className="text-primary hover:underline">Connect Yahoo</Link></li>
            <li><Link href="/guide/sleeper" className="text-primary hover:underline">Connect Sleeper</Link></li>
            <li><Link href="/guide/claude" className="text-primary hover:underline">Use Flaim with Claude</Link></li>
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">Use Flaim with ChatGPT</Link></li>
            <li><Link href="/guide/perplexity" className="text-primary hover:underline">Use Flaim with Perplexity</Link></li>
          </ul>
        </section>

        <div className="border-t pt-4">
          <Link href="/guide" className="text-sm text-primary hover:underline">
            &larr; Back to guide overview
          </Link>
        </div>
      </div>
    </div>
  );
}
