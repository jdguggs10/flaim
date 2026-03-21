import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Connect Yahoo Fantasy to ChatGPT, Claude, or Gemini | Flaim',
  description:
    'Step-by-step guide to connecting your Yahoo fantasy leagues to AI assistants using Flaim. No extension needed — just sign in with Yahoo.',
  alternates: {
    canonical: 'https://flaim.app/guide/yahoo',
  },
};

export default function YahooGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Connect Yahoo Fantasy to ChatGPT, Claude, or Gemini</h1>
        <p className="text-muted-foreground mb-8">
          Flaim connects your Yahoo fantasy leagues to AI assistants for read-only analysis. No extension needed — just sign in with your Yahoo account and Flaim handles the rest. Setup takes about 5 minutes.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account (<a href="https://flaim.app" className="text-primary hover:underline">flaim.app</a>)</li>
            <li>A Yahoo account with an active fantasy league</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Create a Flaim account at <a href="https://flaim.app" className="text-primary hover:underline">flaim.app</a></li>
            <li>Click &ldquo;Authenticate Yahoo&rdquo; on the Flaim homepage</li>
            <li>Sign in with your Yahoo account and authorize Flaim</li>
            <li>Yahoo auto-discovers all your active leagues</li>
            <li>Add the Flaim MCP server URL to your AI assistant: <code className="text-xs bg-muted px-1 py-0.5 rounded">https://api.flaim.app/mcp</code>{' '}
              (<Link href="/guide" className="text-primary hover:underline">AI setup details</Link>)</li>
            <li>Sign in to Flaim and approve the connection</li>
            <li>Start chatting about your league</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Supported sports</h2>
          <p className="text-muted-foreground">
            Football, baseball, basketball, and hockey.
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
