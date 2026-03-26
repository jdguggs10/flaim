import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Flaim with Claude | Flaim',
  description:
    'Add Flaim to Claude, authorize once, and verify Claude can see your linked leagues before you rely on it for fantasy analysis.',
  alternates: {
    canonical: 'https://flaim.app/guide/claude',
  },
};

export default function ClaudeGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Use Flaim with Claude',
            description: 'Add Flaim as a Claude connector for read-only fantasy league analysis.',
            step: [
              {
                '@type': 'HowToStep',
                name: 'Connect a league first',
                text: 'Use https://flaim.app/leagues to connect ESPN, Yahoo, or Sleeper before setting up Claude.',
              },
              {
                '@type': 'HowToStep',
                name: 'Add the connector',
                text: 'Go to Claude connector settings and add https://api.flaim.app/mcp as a custom connector.',
              },
              {
                '@type': 'HowToStep',
                name: 'Authorize Flaim',
                text: 'Sign in to Flaim and approve access.',
              },
              {
                '@type': 'HowToStep',
                name: 'Test it',
                text: 'Start a fresh conversation and ask what leagues you have.',
              },
            ],
          }),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">Use Flaim with Claude</h1>
        <p className="mb-8 text-muted-foreground">
          Claude is the smoothest Flaim path right now. Connect your leagues first in
          <Link href="/leagues" className="text-primary hover:underline"> /leagues</Link>, then add Flaim as a custom
          connector in Claude and verify it can see your account data in a fresh chat.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Connect at least one ESPN, Yahoo, or Sleeper league in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.</li>
            <li>Use a Claude plan that supports connectors.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Add Flaim in Claude</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Claude connector settings</a>.</li>
            <li>Add a custom connector and use <code className="rounded bg-muted px-1 py-0.5 text-xs">https://api.flaim.app/mcp</code> as the server URL.</li>
            <li>Authorize Flaim when the browser flow opens.</li>
            <li>Start a fresh Claude conversation for your first test.</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Claude shows Flaim as an authorized connector.</li>
            <li>A fresh chat can answer &ldquo;What leagues do I have?&rdquo;</li>
            <li>Claude can follow up with league-specific questions like roster, matchup, or standings.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">If something goes wrong</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Claude authorized successfully but returns no leagues: go back to <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and finish platform setup first.</li>
            <li>Claude does not invoke Flaim on its own: start a fresh chat and be explicit about wanting your connected league data.</li>
            <li>The Claude UI moved: use Anthropic&apos;s latest connector settings flow, then come back to the same MCP URL.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What happens next</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Ask a simple grounding question first, then move to lineup or waiver decisions.</li>
            <li>If you use multiple leagues, name the one you want in your first prompt.</li>
            <li>Keep <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> handy if you want to change your default or reconnect a platform later.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Other AI guides</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">Use Flaim with ChatGPT</Link></li>
            <li><Link href="/guide/perplexity" className="text-primary hover:underline">Use Flaim with Perplexity</Link></li>
            <li><Link href="/guide/gemini" className="text-primary hover:underline">Gemini status</Link></li>
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
