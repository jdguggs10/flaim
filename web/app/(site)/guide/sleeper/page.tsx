import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Connect Sleeper Fantasy to ChatGPT, Claude, or Gemini | Flaim',
  description:
    'Step-by-step guide to connecting your Sleeper fantasy leagues to AI assistants using Flaim. Just your username — no extension, no OAuth.',
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
            name: 'Connect Sleeper Fantasy to ChatGPT, Claude, or Gemini',
            description: 'Step-by-step guide to connecting your Sleeper fantasy leagues to AI assistants using Flaim.',
            step: [
              { '@type': 'HowToStep', name: 'Create a Flaim account', text: 'Create a Flaim account at flaim.app.' },
              { '@type': 'HowToStep', name: 'Enter your Sleeper username', text: 'Enter your Sleeper username on the Flaim homepage.' },
              { '@type': 'HowToStep', name: 'Leagues auto-discovered', text: 'Flaim auto-discovers your leagues.' },
              { '@type': 'HowToStep', name: 'Add Flaim to your AI assistant', text: 'Add the Flaim MCP server URL (https://api.flaim.app/mcp) to your AI assistant.' },
              { '@type': 'HowToStep', name: 'Authorize', text: 'Sign in to Flaim and approve the connection.' },
              { '@type': 'HowToStep', name: 'Start chatting', text: 'Start chatting about your league.' },
            ],
          }),
        }}
      />
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Connect Sleeper Fantasy to ChatGPT, Claude, or Gemini</h1>
        <p className="text-muted-foreground mb-8">
          Flaim connects your Sleeper fantasy leagues to AI assistants for read-only analysis. Sleeper has a public API, so there&apos;s no extension and no OAuth to Sleeper — just enter your username. Setup takes a couple of minutes.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account (<Link href="/" className="text-primary hover:underline">flaim.app</Link>)</li>
            <li>Your Sleeper username</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Create a Flaim account at <Link href="/" className="text-primary hover:underline">flaim.app</Link></li>
            <li>Enter your Sleeper username on the Flaim homepage</li>
            <li>Flaim auto-discovers your leagues</li>
            <li>Add the Flaim MCP server URL to your AI assistant: <code className="text-xs bg-muted px-1 py-0.5 rounded">https://api.flaim.app/mcp</code>{' '}
              (<Link href="/guide" className="text-primary hover:underline">AI setup details</Link>)</li>
            <li>Sign in to Flaim and approve the connection</li>
            <li>Start chatting about your league</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Supported sports</h2>
          <p className="text-muted-foreground">
            Football and basketball.
          </p>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Other platforms</h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><Link href="/guide/espn" className="text-primary hover:underline">Connect ESPN Fantasy to AI</Link> — requires Chrome extension</li>
            <li><Link href="/guide/yahoo" className="text-primary hover:underline">Connect Yahoo Fantasy to AI</Link> — no extension needed</li>
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
