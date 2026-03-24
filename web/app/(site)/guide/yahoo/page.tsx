import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Connect Yahoo | Flaim',
  description:
    'Step-by-step guide to connecting your Yahoo fantasy leagues to AI assistants using Flaim. No extension needed. Just sign in with Yahoo.',
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
            description: 'Step-by-step guide to connecting your Yahoo fantasy leagues to AI assistants using Flaim.',
            step: [
              { '@type': 'HowToStep', name: 'Create a Flaim account', text: 'Create a Flaim account at flaim.app.' },
              { '@type': 'HowToStep', name: 'Authenticate Yahoo', text: 'Click "Authenticate Yahoo" on the Flaim homepage.' },
              { '@type': 'HowToStep', name: 'Sign in with Yahoo', text: 'Sign in with your Yahoo account and authorize Flaim.' },
              { '@type': 'HowToStep', name: 'Leagues auto-discovered', text: 'Yahoo auto-discovers all your active leagues.' },
              { '@type': 'HowToStep', name: 'Add Flaim to your AI assistant', text: 'Add the Flaim MCP server URL (https://api.flaim.app/mcp) to your AI assistant.' },
              { '@type': 'HowToStep', name: 'Authorize', text: 'Sign in to Flaim and approve the connection.' },
              { '@type': 'HowToStep', name: 'Start chatting', text: 'Start chatting about your league.' },
            ],
          }),
        }}
      />
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Connect Yahoo</h1>
        <p className="text-muted-foreground mb-8">
          Flaim connects your Yahoo fantasy leagues to AI assistants for read-only analysis. No extension needed. Just sign in with your Yahoo account and Flaim handles the rest. Setup takes about 5 minutes.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account (<Link href="/" className="text-primary hover:underline">flaim.app</Link>)</li>
            <li>A Yahoo account with an active fantasy league</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Create a Flaim account at <Link href="/" className="text-primary hover:underline">flaim.app</Link></li>
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

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Other platforms</h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><Link href="/guide/espn" className="text-primary hover:underline">Connect ESPN</Link> (requires Chrome extension)</li>
            <li><Link href="/guide/sleeper" className="text-primary hover:underline">Connect Sleeper</Link> (just your username)</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Connect your AI</h2>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li><Link href="/guide/claude" className="text-primary hover:underline">Claude</Link></li>
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">ChatGPT</Link></li>
            <li><Link href="/guide/perplexity" className="text-primary hover:underline">Perplexity</Link></li>
            <li><Link href="/guide/gemini" className="text-primary hover:underline">Gemini</Link></li>
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
