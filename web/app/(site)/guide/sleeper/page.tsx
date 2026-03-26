import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Connect Sleeper | Flaim',
  description:
    'Connect Sleeper to Flaim from /leagues, understand what discovery actually covers, and fix the most common username and zero-league issues.',
  alternates: {
    canonical: 'https://flaim.app/guide/sleeper',
  },
};

export default function SleeperGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Connect Sleeper',
            description:
              'Enter your Sleeper username from /leagues, wait for discovery, and verify leagues appear before you set up your AI assistant.',
            step: [
              {
                '@type': 'HowToStep',
                name: 'Open leagues',
                text: 'Sign in to Flaim and open https://flaim.app/leagues.',
              },
              {
                '@type': 'HowToStep',
                name: 'Enter your username',
                text: 'Use the Sleeper card in /leagues and enter your exact Sleeper username.',
              },
              {
                '@type': 'HowToStep',
                name: 'Verify leagues',
                text: 'Wait for Sleeper discovery and confirm the leagues appear in /leagues.',
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
        <h1 className="mb-4 text-3xl font-bold">Connect Sleeper</h1>
        <p className="mb-8 text-muted-foreground">
          Sleeper uses a public API, so this path is lighter than ESPN or Yahoo. There is no extension and no Sleeper
          OAuth. The important part is using your exact username and having realistic expectations about what discovery
          can find.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Sign in to Flaim.</li>
            <li>Use your Sleeper username, not your display name.</li>
            <li>Supported sports are football and basketball.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Do this in /leagues</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and choose Sleeper.</li>
            <li>Enter your exact username and submit.</li>
            <li>Wait for discovery to finish and confirm the leagues show up in Flaim.</li>
            <li>Then add Flaim to Claude, ChatGPT, or Perplexity with <code className="rounded bg-muted px-1 py-0.5 text-xs">https://api.flaim.app/mcp</code>.</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>The Sleeper section in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> shows leagues you can actually use.</li>
            <li>You can identify at least one football or basketball league to test against.</li>
            <li>A fresh AI chat can answer &ldquo;What Sleeper leagues do I have?&rdquo; without needing a reconnect.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What to expect from Sleeper discovery</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Flaim supports football and basketball only.</li>
            <li>Current-season football and basketball leagues are the fastest path into your account history.</li>
            <li>Older leagues can appear through Sleeper&apos;s history chain, but you should not assume every older season will show up immediately.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">If something goes wrong</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Flaim says the user was not found: verify the exact username and try again.</li>
            <li>You connect successfully but no leagues appear: confirm the account has football or basketball leagues and retry.</li>
            <li>Older leagues are missing: start by testing a current league first, then treat historical coverage as a second step.</li>
            <li>Your AI connector was authorized before Sleeper was linked: connect Sleeper first, then start a fresh conversation.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What happens next</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Add Flaim to your AI assistant.</li>
            <li>Start a new chat and ask about your roster, standings, or recent league activity.</li>
            <li>If you connect multiple Sleeper leagues, use the league name in your first prompt.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Related guides</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li><Link href="/guide/espn" className="text-primary hover:underline">Connect ESPN</Link></li>
            <li><Link href="/guide/yahoo" className="text-primary hover:underline">Connect Yahoo</Link></li>
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
