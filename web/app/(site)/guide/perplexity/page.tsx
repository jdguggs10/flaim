import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Flaim with Perplexity | Flaim',
  description:
    'How to add Flaim as a Perplexity custom connector so you can ask about your ESPN, Yahoo, or Sleeper fantasy leagues directly in Perplexity.',
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
            description: 'How to add Flaim as a Perplexity custom connector for fantasy sports analysis.',
            step: [
              { '@type': 'HowToStep', name: 'Open custom connectors', text: 'In Perplexity, click "+ Custom connector" and select Remote.' },
              { '@type': 'HowToStep', name: 'Configure Flaim', text: 'Enter a name, the Flaim MCP server URL (https://api.flaim.app/mcp), select OAuth for authentication, and Streamable HTTP for transport.' },
              { '@type': 'HowToStep', name: 'Authorize Flaim', text: 'Sign in to your Flaim account and approve the connection.' },
              { '@type': 'HowToStep', name: 'Start chatting', text: 'Ask Perplexity about your fantasy leagues. It now has access to your real league data.' },
            ],
          }),
        }}
      />
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Use Flaim with Perplexity</h1>
        <p className="text-muted-foreground mb-8">
          Perplexity supports custom remote connectors via MCP. Once connected, you can ask Perplexity about your ESPN, Yahoo, and Sleeper fantasy leagues, combining its web search capabilities with your real league data.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account with at least one connected league (<Link href="/" className="text-primary hover:underline">flaim.app</Link>)</li>
            <li>A Perplexity Pro, Max, or Enterprise plan</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>In Perplexity, click &ldquo;+ Custom connector&rdquo; and select &ldquo;Remote&rdquo;</li>
            <li>Enter a name (e.g. &ldquo;Flaim Fantasy&rdquo;)</li>
            <li>Enter the MCP server URL: <code className="text-xs bg-muted px-1 py-0.5 rounded">https://api.flaim.app/mcp</code></li>
            <li>Set authentication to &ldquo;OAuth&rdquo; and transport to &ldquo;Streamable HTTP&rdquo;</li>
            <li>Sign in to Flaim and approve the connection</li>
            <li>Start a new thread and ask about your leagues</li>
          </ol>
          <p className="text-sm text-muted-foreground mt-3">
            For the latest details, see{' '}
            <a href="https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Perplexity&apos;s custom connector docs</a>.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Why Perplexity + Flaim?</h2>
          <p className="text-muted-foreground">
            Perplexity excels at real-time web search. Combined with Flaim&apos;s league data, it can pull your roster and matchup context while simultaneously searching for the latest injury reports, trade rumors, and expert analysis, all in one answer.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Other AI assistants</h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><Link href="/guide/claude" className="text-primary hover:underline">Use Flaim with Claude</Link></li>
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">Use Flaim with ChatGPT</Link></li>
            <li><Link href="/guide/gemini" className="text-primary hover:underline">Use Flaim with Gemini</Link></li>
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
