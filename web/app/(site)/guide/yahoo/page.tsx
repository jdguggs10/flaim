import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Connect Yahoo | Flaim',
  description:
    'Connect Yahoo to Flaim from /leagues, verify your leagues were discovered, and fix the most common auth and refresh problems.',
  alternates: {
    canonical: 'https://flaim.app/guide/yahoo',
  },
};

export default function YahooGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Connect Yahoo',
            description:
              'Start Yahoo auth from /leagues, wait for league discovery, and verify the leagues appear before moving to AI setup.',
            step: [
              {
                '@type': 'HowToStep',
                name: 'Open leagues',
                text: 'Sign in to Flaim and open https://flaim.app/leagues.',
              },
              {
                '@type': 'HowToStep',
                name: 'Authenticate Yahoo',
                text: 'Use the Yahoo card in /leagues to sign in with Yahoo and approve access.',
              },
              {
                '@type': 'HowToStep',
                name: 'Verify leagues',
                text: 'Confirm that your Yahoo leagues appear in /leagues after discovery finishes.',
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
        <h1 className="mb-4 text-3xl font-bold">Connect Yahoo</h1>
        <p className="mb-8 text-muted-foreground">
          Yahoo is the simplest private-platform setup in Flaim. Start auth from
          <Link href="/leagues" className="text-primary hover:underline"> /leagues</Link>, approve access, and wait for
          league discovery to finish before you move on to your AI client.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Sign in to Flaim.</li>
            <li>Use the Yahoo account that actually has the fantasy leagues you want.</li>
            <li>Supported sports are football, baseball, basketball, and hockey.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Do this in /leagues</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and choose Yahoo.</li>
            <li>Start Yahoo authentication and approve Flaim&apos;s access request.</li>
            <li>Return to Flaim and wait for discovery to finish. Do not assume auth success means your leagues are ready yet.</li>
            <li>Confirm that the Yahoo section shows leagues you can use.</li>
            <li>Then add Flaim to Claude, ChatGPT, or Perplexity with <code className="rounded bg-muted px-1 py-0.5 text-xs">https://api.flaim.app/mcp</code>.</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>The Yahoo section in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> shows connected leagues, not just a successful login.</li>
            <li>You can tell which league you want to analyze first.</li>
            <li>A fresh AI chat can answer &ldquo;What Yahoo leagues do I have?&rdquo; without asking you to reconnect.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">If something goes wrong</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Yahoo auth completed but Flaim still looks disconnected: retry the auth flow from <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and make sure the popup or redirect fully finishes.</li>
            <li>Auth worked but you see zero leagues: confirm the Yahoo account has supported active leagues and reconnect.</li>
            <li>Yahoo worked before and stopped later: reconnect to refresh access.</li>
            <li>Your AI connector was authorized before Yahoo finished linking: complete Yahoo setup first, then start a fresh conversation.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What happens next</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Add Flaim to your AI assistant.</li>
            <li>Start a new chat and ask about your roster, standings, or recent moves.</li>
            <li>If you have multiple Yahoo leagues, mention the league name in your first prompt.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Related guides</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li><Link href="/guide/espn" className="text-primary hover:underline">Connect ESPN</Link></li>
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
