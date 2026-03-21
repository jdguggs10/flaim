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
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Connect Sleeper Fantasy to ChatGPT, Claude, or Gemini</h1>
        <p className="text-muted-foreground mb-8">
          Flaim connects your Sleeper fantasy leagues to AI assistants for read-only analysis. Sleeper has a public API, so there&apos;s no extension and no OAuth to Sleeper — just enter your username. Setup takes a couple of minutes.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account (<a href="https://flaim.app" className="text-primary hover:underline">flaim.app</a>)</li>
            <li>Your Sleeper username</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Create a Flaim account at <a href="https://flaim.app" className="text-primary hover:underline">flaim.app</a></li>
            <li>Enter your Sleeper username on the Flaim homepage</li>
            <li>Flaim auto-discovers your leagues</li>
            <li>Add the Flaim MCP server URL to your AI assistant: <code className="text-xs bg-muted px-1 py-0.5 rounded">https://api.flaim.app/mcp</code>{' '}
              (<Link href="/guide" className="text-primary hover:underline">AI setup details</Link>)</li>
            <li>Complete the OAuth authorization screen</li>
            <li>Start chatting about your league</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Supported sports</h2>
          <p className="text-muted-foreground">
            Football and basketball. Baseball and hockey support is in progress.
          </p>
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
