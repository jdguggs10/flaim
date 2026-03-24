import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Connect ESPN Fantasy to ChatGPT, Claude, or Gemini | Flaim',
  description:
    'Step-by-step guide to connecting your ESPN fantasy leagues to AI assistants using Flaim. Works with football, baseball, basketball, and hockey.',
  alternates: {
    canonical: 'https://flaim.app/guide/espn',
  },
};

export default function EspnGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'HowTo',
            name: 'Connect ESPN Fantasy to ChatGPT, Claude, or Gemini',
            description: 'Step-by-step guide to connecting your ESPN fantasy leagues to AI assistants using Flaim.',
            step: [
              { '@type': 'HowToStep', name: 'Create a Flaim account', text: 'Create a Flaim account at flaim.app.' },
              { '@type': 'HowToStep', name: 'Install the Chrome extension', text: 'Install the Flaim Chrome extension from the Chrome Web Store.' },
              { '@type': 'HowToStep', name: 'Log in to ESPN', text: 'Log in to fantasy.espn.com in Chrome.' },
              { '@type': 'HowToStep', name: 'Sync your leagues', text: 'Click the Flaim extension icon and hit Sync.' },
              { '@type': 'HowToStep', name: 'Add Flaim to your AI assistant', text: 'Add the Flaim MCP server URL (https://api.flaim.app/mcp) to your AI assistant.' },
              { '@type': 'HowToStep', name: 'Authorize', text: 'Sign in to Flaim and approve the connection.' },
              { '@type': 'HowToStep', name: 'Start chatting', text: 'Start chatting about your league.' },
            ],
          }),
        }}
      />
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Connect ESPN Fantasy to ChatGPT, Claude, or Gemini</h1>
        <p className="text-muted-foreground mb-8">
          Flaim connects your ESPN fantasy leagues to AI assistants for read-only analysis. ESPN requires a Chrome extension to sync your league credentials — setup takes about 5 minutes.
        </p>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">What you need</h2>
          <ul className="list-disc list-inside text-muted-foreground space-y-1">
            <li>A Flaim account (<Link href="/" className="text-primary hover:underline">flaim.app</Link>)</li>
            <li>Google Chrome browser</li>
            <li>An active ESPN fantasy league</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Step by step</h2>
          <ol className="list-decimal list-inside text-muted-foreground space-y-2">
            <li>Create a Flaim account at <Link href="/" className="text-primary hover:underline">flaim.app</Link></li>
            <li>Install the Flaim Chrome extension from the Chrome Web Store</li>
            <li>Log in to fantasy.espn.com in Chrome</li>
            <li>Click the Flaim extension icon and hit Sync</li>
            <li>Add the Flaim MCP server URL to your AI assistant: <code className="text-xs bg-muted px-1 py-0.5 rounded">https://api.flaim.app/mcp</code>{' '}
              (<Link href="/guide" className="text-primary hover:underline">AI setup details</Link>)</li>
            <li>Sign in to Flaim and approve the connection</li>
            <li>Start chatting about your league</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="text-xl font-semibold mb-3">Why a Chrome extension?</h2>
          <p className="text-muted-foreground">
            ESPN doesn&apos;t offer a public API for fantasy data. The extension piggybacks on your active ESPN session to grab read-only league data. Your ESPN credentials are encrypted and stored securely — they are never shared with AI providers.
          </p>
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
