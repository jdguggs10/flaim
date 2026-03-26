import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Fantasy League Setup Guides | Flaim',
  description:
    'Use /leagues to connect ESPN, Yahoo, or Sleeper, then add Flaim to Claude, ChatGPT, or Perplexity. See setup, confirmation, and troubleshooting guides.',
  alternates: {
    canonical: 'https://flaim.app/guide',
  },
};

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'ItemList',
            name: 'Fantasy League Setup Guides',
            description:
              'Step-by-step guides to connect fantasy platforms and AI assistants using Flaim.',
            itemListElement: [
              {
                '@type': 'ListItem',
                position: 1,
                name: 'Connect ESPN',
                url: 'https://flaim.app/guide/espn',
              },
              {
                '@type': 'ListItem',
                position: 2,
                name: 'Connect Yahoo',
                url: 'https://flaim.app/guide/yahoo',
              },
              {
                '@type': 'ListItem',
                position: 3,
                name: 'Connect Sleeper',
                url: 'https://flaim.app/guide/sleeper',
              },
              {
                '@type': 'ListItem',
                position: 4,
                name: 'Use Flaim with Claude',
                url: 'https://flaim.app/guide/claude',
              },
              {
                '@type': 'ListItem',
                position: 5,
                name: 'Use Flaim with ChatGPT',
                url: 'https://flaim.app/guide/chatgpt',
              },
              {
                '@type': 'ListItem',
                position: 6,
                name: 'Use Flaim with Perplexity',
                url: 'https://flaim.app/guide/perplexity',
              },
              {
                '@type': 'ListItem',
                position: 7,
                name: 'Gemini status',
                url: 'https://flaim.app/guide/gemini',
              },
            ],
          }),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">Flaim Setup Guides</h1>
        <p className="mb-8 text-muted-foreground">
          Flaim setup starts in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.
          Connect at least one fantasy platform there first, then add Flaim to your AI assistant using the MCP URL
          below. These guides focus on the paths people actually get stuck on: prerequisites, success checks, and
          troubleshooting.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Start here</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Sign in and open <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.</li>
            <li>Connect ESPN, Yahoo, or Sleeper.</li>
            <li>Add Flaim to your AI assistant with <code className="rounded bg-muted px-1 py-0.5 text-xs">https://api.flaim.app/mcp</code>.</li>
            <li>Start a fresh conversation and ask, &ldquo;What leagues do I have?&rdquo;</li>
          </ol>
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-xl font-semibold">Choose your fantasy platform</h2>
          <div className="grid gap-3">
            <Link
              href="/guide/espn"
              className="block rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
            >
              <h3 className="font-semibold">ESPN</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Preferred path: sync with the Flaim Chrome extension from <span className="font-medium">/leagues</span>.
                Manual cookie entry is available as a fallback.
              </p>
            </Link>
            <Link
              href="/guide/yahoo"
              className="block rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
            >
              <h3 className="font-semibold">Yahoo</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Start Yahoo auth from <span className="font-medium">/leagues</span>. Flaim discovers your supported
                leagues after you approve access.
              </p>
            </Link>
            <Link
              href="/guide/sleeper"
              className="block rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
            >
              <h3 className="font-semibold">Sleeper</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter your exact Sleeper username in <span className="font-medium">/leagues</span>. No extension and no
                Sleeper OAuth.
              </p>
            </Link>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Connect your AI assistant</h2>
          <p className="mb-4 text-muted-foreground">
            Claude, ChatGPT, and Perplexity are the live Flaim paths today. Use this MCP URL in the connector setup
            flow:
          </p>
          <div className="mb-4 rounded-lg border bg-muted p-3">
            <code className="text-sm">https://api.flaim.app/mcp</code>
          </div>
          <div className="grid gap-3">
            <Link
              href="/guide/claude"
              className="block rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
            >
              <h3 className="font-semibold">Claude</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Best-supported browser flow. Add Flaim as a custom connector and approve once.
              </p>
            </Link>
            <Link
              href="/guide/chatgpt"
              className="block rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
            >
              <h3 className="font-semibold">ChatGPT</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Live today, but OpenAI changes connector settings often. Use the guide plus OpenAI&apos;s latest docs if
                the menus move.
              </p>
            </Link>
            <Link
              href="/guide/perplexity"
              className="block rounded-lg border bg-background p-4 transition-colors hover:border-foreground/20"
            >
              <h3 className="font-semibold">Perplexity</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Remote connector flow with OAuth auth and Streamable HTTP transport.
              </p>
            </Link>
            <Link
              href="/guide/gemini"
              className="block rounded-lg border border-dashed bg-background p-4 transition-colors hover:border-foreground/20"
            >
              <h3 className="font-semibold">Gemini</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Not available yet. This page explains the current status so users do not waste time hunting for a setup
                flow that is not live.
              </p>
            </Link>
          </div>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know setup is done</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Your platform connection in <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> shows leagues you can use.</li>
            <li>Your AI app shows a Flaim connector that has already been authorized.</li>
            <li>A fresh chat can answer a simple question like &ldquo;What leagues do I have?&rdquo; without failing auth.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Common setup snags</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>ESPN synced but no leagues show up: resync, verify the right ESPN account, or use the manual fallback in the ESPN guide.</li>
            <li>Yahoo auth worked but leagues are missing: reconnect from <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and confirm the account actually has supported fantasy leagues.</li>
            <li>Sleeper says user not found: use your exact username, not your display name.</li>
            <li>Your AI app connected before your leagues were linked: finish platform setup first, then start a fresh chat.</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
