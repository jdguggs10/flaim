import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Flaim with Perplexity | Flaim',
  description:
    'Add Flaim to Perplexity as a remote connector, use the right auth and transport settings, and verify it can see your linked leagues.',
  alternates: {
    canonical: 'https://flaim.app/guide/perplexity',
  },
};

export default function PerplexityGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Use Flaim with Perplexity',
            description: 'Add Flaim as a Perplexity connector for read-only fantasy league analysis.',
            step: [
              {
                '@type': 'HowToStep',
                name: 'Connect a league first',
                text: 'Use https://flaim.app/leagues to connect ESPN, Yahoo, or Sleeper before setting up Perplexity.',
              },
              {
                '@type': 'HowToStep',
                name: 'Create the remote connector',
                text: 'In Perplexity, add a remote connector with https://api.flaim.app/mcp, OAuth auth, and Streamable HTTP transport.',
              },
              {
                '@type': 'HowToStep',
                name: 'Authorize Flaim',
                text: 'Sign in to Flaim and approve access.',
              },
              {
                '@type': 'HowToStep',
                name: 'Test it',
                text: 'Start a fresh thread and ask what leagues you have.',
              },
            ],
          }),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">Use Flaim with Perplexity</h1>
        <p className="mb-8 text-muted-foreground">
          Perplexity supports Flaim through a remote MCP connector. Connect your leagues first in
          <Link href="/leagues" className="text-primary hover:underline"> /leagues</Link>, then configure the connector
          with the correct URL, auth method, and transport settings.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Connect at least one ESPN, Yahoo, or Sleeper league in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.</li>
            <li>Use a Perplexity plan that supports custom connectors.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Add Flaim in Perplexity</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open Perplexity&apos;s connector settings and choose to add a remote connector.</li>
            <li>Use <code className="rounded bg-muted px-1 py-0.5 text-xs">https://api.flaim.app/mcp</code> as the URL.</li>
            <li>Set authentication to OAuth.</li>
            <li>Set transport to Streamable HTTP.</li>
            <li>Authorize Flaim and start a fresh thread.</li>
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            If you want Perplexity&apos;s current UI details, check{' '}
            <a
              href="https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Perplexity&apos;s connector docs
            </a>
            .
          </p>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Perplexity shows Flaim as a connected remote connector.</li>
            <li>A fresh thread can answer &ldquo;What leagues do I have?&rdquo;</li>
            <li>Follow-up questions about roster or waiver options work without another auth loop.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">If something goes wrong</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>The connector exists but returns auth or transport errors: confirm you used OAuth and Streamable HTTP.</li>
            <li>Perplexity connects but sees no leagues: finish platform setup in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> first, then start a fresh thread.</li>
            <li>You created multiple stale connectors while testing: delete the extras and keep one clean Flaim connector.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What happens next</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Use Perplexity when you want league context plus current web context in the same answer.</li>
            <li>Start with one league-specific question before you branch into research-heavy prompts.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Other AI guides</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li><Link href="/guide/claude" className="text-primary hover:underline">Use Flaim with Claude</Link></li>
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">Use Flaim with ChatGPT</Link></li>
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
