import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Flaim with ChatGPT | Flaim',
  description:
    'Add Flaim to ChatGPT, verify the connector is authorized, and handle the common issue where ChatGPT setup succeeds before any leagues are actually linked.',
  alternates: {
    canonical: 'https://flaim.app/guide/chatgpt',
  },
};

export default function ChatGptGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Use Flaim with ChatGPT',
            description: 'Add Flaim as a ChatGPT connector for read-only fantasy league analysis.',
            step: [
              {
                '@type': 'HowToStep',
                name: 'Connect a league first',
                text: 'Use https://flaim.app/leagues to connect ESPN, Yahoo, or Sleeper before setting up ChatGPT.',
              },
              {
                '@type': 'HowToStep',
                name: 'Create the connector',
                text: 'In ChatGPT settings, create a connector using https://api.flaim.app/mcp.',
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
        <h1 className="mb-4 text-3xl font-bold">Use Flaim with ChatGPT</h1>
        <p className="mb-8 text-muted-foreground">
          ChatGPT works with Flaim today, but OpenAI changes the connector UI often. The stable part is the same: link
          your leagues first in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>, use the
          Flaim MCP URL, then verify the connector in a fresh chat before you rely on it.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Connect at least one ESPN, Yahoo, or Sleeper league in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.</li>
            <li>Use a ChatGPT plan and settings flow that supports connectors.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Add Flaim in ChatGPT</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open ChatGPT settings and find the connector setup flow.</li>
            <li>Create a connector and use <code className="rounded bg-muted px-1 py-0.5 text-xs">https://api.flaim.app/mcp</code> as the server URL.</li>
            <li>Authorize Flaim when prompted.</li>
            <li>Start a fresh chat for the first test.</li>
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            If the menus moved, use{' '}
            <a
              href="https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              OpenAI&apos;s latest connector docs
            </a>
            .
          </p>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>ChatGPT shows Flaim as an authorized connector.</li>
            <li>A fresh chat can answer &ldquo;What leagues do I have?&rdquo;</li>
            <li>Follow-up questions about rosters or standings work without another auth prompt.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">If something goes wrong</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>The connector was created but ChatGPT cannot see any leagues: finish platform setup in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> first, then start a fresh chat.</li>
            <li>ChatGPT does not call Flaim automatically: be explicit that you want it to use your connected fantasy league data.</li>
            <li>The settings UI no longer matches this page: follow OpenAI&apos;s current connector docs, but keep the same Flaim MCP URL.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What happens next</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Start with one grounding question, then move into deeper lineup or trade analysis.</li>
            <li>If you use multiple leagues, mention the platform or league name in your prompt.</li>
            <li>Reconnect or refresh in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> if the league list changes later.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Other AI guides</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li><Link href="/guide/claude" className="text-primary hover:underline">Use Flaim with Claude</Link></li>
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
