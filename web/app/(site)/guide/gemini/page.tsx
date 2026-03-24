import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Flaim with Gemini CLI | Flaim',
  description:
    'How to add Flaim to Gemini CLI so you can ask about your ESPN, Yahoo, or Sleeper fantasy leagues. The Gemini web app does not support custom connectors yet.',
  alternates: {
    canonical: 'https://flaim.app/guide/gemini',
  },
};

export default function GeminiGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Use Flaim with Gemini',
            description: 'How to add Flaim to Gemini CLI for fantasy sports analysis.',
            step: [
              { '@type': 'HowToStep', name: 'Add Flaim to Gemini CLI', text: 'Run: gemini mcp add --transport http flaim https://api.flaim.app/mcp' },
              { '@type': 'HowToStep', name: 'Authorize Flaim', text: 'Run: /mcp auth flaim, then sign in to your Flaim account and approve the connection.' },
              { '@type': 'HowToStep', name: 'Start chatting', text: 'Ask Gemini about your fantasy leagues. It now has access to your real league data.' },
            ],
          }),
        }}
      />
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Use Flaim with Gemini CLI</h1>
        <p className="text-muted-foreground mb-4">
          Flaim connects to Gemini CLI via MCP, giving it read-only access to your ESPN, Yahoo, and Sleeper fantasy leagues. Once connected, you can ask Gemini about your roster, matchups, standings, and more, all grounded in your actual league data.
        </p>
        <p className="text-sm text-muted-foreground mb-8 p-3 rounded-lg border bg-muted">
          <strong>Note:</strong> The Gemini web app (gemini.google.com) does not support custom MCP connectors yet. This guide is for the <a href="https://github.com/google-gemini/gemini-cli" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Gemini CLI</a>, a command-line tool for developers.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account with at least one connected league (<Link href="/" className="text-primary hover:underline">flaim.app</Link>)</li>
            <li><a href="https://github.com/google-gemini/gemini-cli" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Gemini CLI</a> installed</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Add Flaim as an MCP server:
              <div className="mt-1">
                <code className="text-xs bg-muted px-2 py-1 rounded block">gemini mcp add --transport http flaim https://api.flaim.app/mcp</code>
              </div>
            </li>
            <li>Authenticate with Flaim:
              <div className="mt-1">
                <code className="text-xs bg-muted px-2 py-1 rounded block">/mcp auth flaim</code>
              </div>
            </li>
            <li>Sign in to Flaim in the browser window that opens and approve the connection</li>
            <li>Start asking about your leagues</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Tips</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Set a default league at <Link href="/leagues" className="text-primary hover:underline">flaim.app/leagues</Link> so Gemini knows which league to use without asking</li>
            <li>If Gemini doesn&apos;t activate Flaim automatically, just say &ldquo;Use Flaim&rdquo;</li>
            <li>For the best experience, install the <Link href="/guide" className="text-primary hover:underline">Flaim skill</Link>, which teaches Gemini how to think like a fantasy analyst</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Other AI assistants</h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><Link href="/guide/claude" className="text-primary hover:underline">Use Flaim with Claude</Link></li>
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">Use Flaim with ChatGPT</Link></li>
            <li><Link href="/guide/perplexity" className="text-primary hover:underline">Use Flaim with Perplexity</Link></li>
          </ul>
        </section>

        <div className="pt-4 border-t">
          <Link href="/guide" className="text-sm text-primary hover:underline">
            &larr; Back to guide overview
          </Link>
        </div>
      </div>
    </div>
  );
}
