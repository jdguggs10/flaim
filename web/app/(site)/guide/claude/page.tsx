import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Flaim with Claude | Flaim',
  description:
    'How to add Flaim as a Claude connector so you can ask about your ESPN, Yahoo, or Sleeper fantasy leagues directly in Claude.',
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
            description: 'How to add Flaim as a Claude connector for fantasy sports analysis.',
            step: [
              { '@type': 'HowToStep', name: 'Open Claude settings', text: 'Go to claude.ai/settings/connectors.' },
              { '@type': 'HowToStep', name: 'Add custom connector', text: 'Click "Add custom connector" and enter the Flaim MCP server URL: https://api.flaim.app/mcp' },
              { '@type': 'HowToStep', name: 'Authorize Flaim', text: 'Sign in to your Flaim account and approve the connection.' },
              { '@type': 'HowToStep', name: 'Start chatting', text: 'Ask Claude about your fantasy leagues. It now has access to your real league data.' },
            ],
          }),
        }}
      />
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Use Flaim with Claude</h1>
        <p className="text-muted-foreground mb-8">
          Flaim connects to Claude as a custom connector, giving it read-only access to your ESPN, Yahoo, and Sleeper fantasy leagues. Once connected, you can ask Claude about your roster, matchups, standings, and more, all grounded in your actual league data.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account with at least one connected league (<Link href="/" className="text-primary hover:underline">flaim.app</Link>)</li>
            <li>A Claude Pro, Max, Team, or Enterprise plan (connectors aren&apos;t available on the free plan)</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Go to <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">claude.ai/settings/connectors</a></li>
            <li>Click &ldquo;Add custom connector&rdquo;</li>
            <li>Enter the Flaim MCP server URL: <code className="text-xs bg-muted px-1 py-0.5 rounded">https://api.flaim.app/mcp</code></li>
            <li>Sign in to Flaim and approve the connection</li>
            <li>Start a new conversation and ask about your leagues</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Tips</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>Set a default league at <Link href="/leagues" className="text-primary hover:underline">flaim.app/leagues</Link> so Claude knows which league to use without asking</li>
            <li>If Claude doesn&apos;t activate Flaim automatically, just say &ldquo;Use Flaim&rdquo;</li>
            <li>For the best experience, install the <Link href="/guide" className="text-primary hover:underline">Flaim skill</Link>, which teaches Claude how to think like a fantasy analyst</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Other AI assistants</h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">Use Flaim with ChatGPT</Link></li>
            <li><Link href="/guide/gemini" className="text-primary hover:underline">Use Flaim with Gemini</Link></li>
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
