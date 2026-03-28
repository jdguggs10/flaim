import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'AI Assistant Setup: Claude, ChatGPT, Perplexity & Gemini | Flaim',
  description:
    'Add Flaim to Claude, ChatGPT, or Perplexity using one MCP URL. Step-by-step setup, authorization, and troubleshooting for each AI assistant.',
  alternates: {
    canonical: 'https://flaim.app/guide/ai',
  },
};

export default function AiGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: 'Use Flaim with Claude for fantasy sports analysis',
              dateModified: '2026-03-28',
              description: 'Add Flaim as a Claude connector and authorize it for read-only fantasy league access.',
              step: [
                { '@type': 'HowToStep', name: 'Connect leagues first', text: 'Use https://flaim.app/leagues to connect ESPN, Yahoo, or Sleeper.' },
                { '@type': 'HowToStep', name: 'Add the connector', text: 'Go to Claude connector settings and add https://api.flaim.app/mcp as a custom connector.' },
                { '@type': 'HowToStep', name: 'Authorize Flaim', text: 'Sign in to Flaim and approve access.' },
                { '@type': 'HowToStep', name: 'Test it', text: 'Start a fresh conversation and ask what leagues you have.' },
              ],
            },
            {
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: 'Use Flaim with ChatGPT for fantasy sports analysis',
              dateModified: '2026-03-28',
              description: 'Add Flaim as a ChatGPT connector for read-only fantasy league analysis.',
              step: [
                { '@type': 'HowToStep', name: 'Connect leagues first', text: 'Use https://flaim.app/leagues to connect ESPN, Yahoo, or Sleeper.' },
                { '@type': 'HowToStep', name: 'Create the connector', text: 'In ChatGPT settings, create a connector using https://api.flaim.app/mcp.' },
                { '@type': 'HowToStep', name: 'Authorize Flaim', text: 'Sign in to Flaim and approve access.' },
                { '@type': 'HowToStep', name: 'Test it', text: 'Start a fresh conversation and ask what leagues you have.' },
              ],
            },
            {
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: 'Use Flaim with Perplexity for fantasy sports analysis',
              dateModified: '2026-03-28',
              description: 'Add Flaim as a Perplexity remote connector with OAuth auth and Streamable HTTP transport.',
              step: [
                { '@type': 'HowToStep', name: 'Connect leagues first', text: 'Use https://flaim.app/leagues to connect ESPN, Yahoo, or Sleeper.' },
                { '@type': 'HowToStep', name: 'Create the remote connector', text: 'In Perplexity, add a remote connector with https://api.flaim.app/mcp, OAuth auth, and Streamable HTTP transport.' },
                { '@type': 'HowToStep', name: 'Authorize Flaim', text: 'Sign in to Flaim and approve access.' },
                { '@type': 'HowToStep', name: 'Test it', text: 'Start a fresh thread and ask what leagues you have.' },
              ],
            },
          ]),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">AI Assistant Setup</h1>
        <p className="mb-4 text-lg font-medium text-foreground">
          Add <code className="rounded bg-muted px-1 py-0.5 text-sm">https://api.flaim.app/mcp</code> as a connector in Claude, ChatGPT, or Perplexity, authorize once, and start asking about your leagues.
        </p>
        <p className="text-xs text-muted-foreground">Last updated March 2026</p>
        <p className="mt-4 mb-8 text-muted-foreground">
          Flaim works with Claude, ChatGPT, and Perplexity today. The setup is similar across all
          three: connect your leagues first in{' '}
          <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>, then
          add Flaim as a connector in your AI app using the MCP URL below.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">The setup flow</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              <Link href="/guide/platforms" className="text-primary hover:underline">
                Connect at least one fantasy platform
              </Link>{' '}
              in{' '}
              <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.
            </li>
            <li>
              Add Flaim as a connector in your AI app using this MCP URL:
            </li>
          </ol>
          <div className="my-4 rounded-lg border bg-muted p-3">
            <code className="text-sm">https://api.flaim.app/mcp</code>
          </div>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground" start={3}>
            <li>Authorize Flaim when the browser flow opens.</li>
            <li>
              Start a fresh conversation and ask &ldquo;What leagues do I have?&rdquo; to
              confirm the connection.
            </li>
          </ol>
        </section>

        {/* Claude */}
        <section id="claude" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Claude</h2>
          <p className="mb-4 text-muted-foreground">
            Claude is the smoothest Flaim path right now. You need a Claude plan that supports
            connectors.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{' '}
              <a
                href="https://claude.ai/settings/connectors"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Claude connector settings
              </a>
              .
            </li>
            <li>
              Add a custom connector and use{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                https://api.flaim.app/mcp
              </code>{' '}
              as the server URL.
            </li>
            <li>Authorize Flaim when the browser flow opens.</li>
            <li>Start a fresh Claude conversation for your first test. See the{' '}
              <Link href="/guide/sports" className="text-primary hover:underline">sports guide</Link>{' '}
              for example prompts.</li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Claude troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Authorized successfully but returns no leagues: go back to{' '}
                <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>{' '}
                and finish platform setup first.
              </li>
              <li>
                Claude does not invoke Flaim on its own: start a fresh chat and be explicit about
                wanting your connected league data.
              </li>
              <li>
                The Claude UI moved: use Anthropic&apos;s latest connector settings flow, then
                come back to the same MCP URL.
              </li>
            </ul>
          </div>
        </section>

        {/* ChatGPT */}
        <section id="chatgpt" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">ChatGPT</h2>
          <p className="mb-4 text-muted-foreground">
            ChatGPT works with Flaim today, but OpenAI changes the connector UI often. The
            stable part is the MCP URL and the authorize-then-test flow.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>Open ChatGPT settings and find the connector setup flow.</li>
            <li>
              Create a connector and use{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                https://api.flaim.app/mcp
              </code>{' '}
              as the server URL.
            </li>
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
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">ChatGPT troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Connector was created but ChatGPT cannot see any leagues: finish platform setup
                in{' '}
                <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>{' '}
                first, then start a fresh chat.
              </li>
              <li>
                ChatGPT does not call Flaim automatically: be explicit that you want it to use
                your connected fantasy league data.
              </li>
            </ul>
          </div>
        </section>

        {/* Perplexity */}
        <section id="perplexity" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Perplexity</h2>
          <p className="mb-4 text-muted-foreground">
            Perplexity supports Flaim through a remote MCP connector. The key difference is you
            need to set the auth method to OAuth and the transport to Streamable HTTP.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open Perplexity&apos;s connector settings and choose to add a remote connector.
            </li>
            <li>
              Use{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                https://api.flaim.app/mcp
              </code>{' '}
              as the URL.
            </li>
            <li>Set authentication to OAuth.</li>
            <li>Set transport to Streamable HTTP.</li>
            <li>Authorize Flaim and start a fresh thread.</li>
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            For Perplexity&apos;s current UI details, check{' '}
            <a
              href="https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Perplexity&apos;s connector docs
            </a>
            .
          </p>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Perplexity troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Connector exists but returns auth or transport errors: confirm you used OAuth and
                Streamable HTTP.
              </li>
              <li>
                Connected but sees no leagues: finish platform setup in{' '}
                <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>{' '}
                first, then start a fresh thread.
              </li>
              <li>
                Multiple stale connectors from testing: delete the extras and keep one clean
                Flaim connector.
              </li>
            </ul>
          </div>
        </section>

        {/* Gemini */}
        <section id="gemini" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Gemini</h2>
          <p className="text-muted-foreground">
            Gemini is not a live Flaim setup path today. There is no official connector flow for
            Gemini yet, so you do not need to keep hunting through settings for one. When Gemini
            support is ready, it will show up in the app flow and on this page. Use Claude,
            ChatGPT, or Perplexity in the meantime.
          </p>
        </section>

        {/* Shared success */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>Your AI app shows Flaim as an authorized connector.</li>
            <li>
              A fresh conversation can answer &ldquo;What leagues do I have?&rdquo; without
              failing auth.
            </li>
            <li>
              Follow-up questions about rosters, standings, or matchups work without another
              auth prompt.
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Common issues across all AI apps</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              Authorized before your leagues were linked: finish{' '}
              <Link href="/guide/platforms" className="text-primary hover:underline">
                platform setup
              </Link>{' '}
              first, then start a fresh conversation.
            </li>
            <li>
              AI does not call Flaim automatically: start a fresh chat and explicitly ask about
              your connected fantasy league data.
            </li>
            <li>
              Keep{' '}
              <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>{' '}
              handy if you need to reconnect or change your defaults later.
            </li>
          </ul>
        </section>

        <div className="flex items-center gap-4 border-t pt-4 text-sm">
          <Link href="/guide/platforms" className="text-primary hover:underline">
            &larr; Platform setup
          </Link>
          <Link href="/guide/sports" className="text-primary hover:underline">
            How Flaim analyzes sports &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
