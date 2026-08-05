import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ChatGPT & AI Setup for Flaim Fantasy",
  description:
    "Use Flaim Fantasy in ChatGPT, with an optional custom-connector path for compatible AI platforms.",
  alternates: {
    canonical: "https://flaim.app/guide/ai",
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
              "@context": "https://schema.org",
              "@type": "HowTo",
              name: "Use Flaim Fantasy in ChatGPT",
              dateModified: "2026-08-02",
              description:
                "Connect your fantasy leagues in Flaim, then use Flaim Fantasy in ChatGPT for read-only league analysis.",
              step: [
                {
                  "@type": "HowToStep",
                  name: "Connect leagues first",
                  text: "Use https://flaim.app/leagues to connect ESPN, Yahoo, or Sleeper.",
                },
                {
                  "@type": "HowToStep",
                  name: "Set a default context",
                  text: "Choose the sport or league ChatGPT should use first if you have more than one connected league.",
                },
                {
                  "@type": "HowToStep",
                  name: "Open Flaim Fantasy in ChatGPT",
                  text: "Open ChatGPT, use Flaim Fantasy, and authorize Flaim if prompted.",
                },
                {
                  "@type": "HowToStep",
                  name: "Ask about your league",
                  text: "Start a fresh conversation and ask what leagues you have or ask a specific roster, matchup, standings, or waiver question.",
                },
              ],
            },
          ]),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">ChatGPT & AI Setup</h1>
        <p className="mb-4 text-lg font-medium text-foreground">
          ChatGPT is the primary Flaim setup path. Flaim Fantasy is available in
          ChatGPT for read-only fantasy sports analysis.
        </p>
        <p className="text-xs text-muted-foreground">Last updated August 2026</p>
        <p className="mt-4 mb-8 text-muted-foreground">
          Start by connecting your fantasy platforms in{" "}
          <Link href="/leagues" className="text-primary hover:underline">
            /leagues
          </Link>
          . That account setup is what ChatGPT uses when you open Flaim
          Fantasy. Advanced users can also add Flaim manually in compatible AI
          platforms that support custom remote connectors.
        </p>

        <section id="custom-connectors" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">The setup flow</h2>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              <Link
                href="/guide/platforms"
                className="text-primary hover:underline"
              >
                Connect at least one fantasy platform
              </Link>{" "}
              in{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                /leagues
              </Link>
              .
            </li>
            <li>
              Set the default sport or league ChatGPT should use first.
            </li>
            <li>
              Open ChatGPT and use Flaim Fantasy. For an optional manual custom
              connector, add Flaim with this MCP URL:
            </li>
          </ol>
          <div className="my-4 rounded-lg border bg-muted p-3">
            <code className="text-sm">https://api.flaim.app/mcp</code>
          </div>
          <ol
            className="list-decimal list-inside space-y-2 text-muted-foreground"
            start={4}
          >
            <li>Authorize Flaim when the browser flow opens.</li>
            <li>
              Start a fresh conversation and ask &ldquo;What leagues do I
              have?&rdquo; to confirm the connection.
            </li>
          </ol>
        </section>

        {/* ChatGPT */}
        <section id="chatgpt" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">ChatGPT</h2>
          <p className="mb-4 text-muted-foreground">
            Flaim Fantasy is available in ChatGPT. Connect your leagues in Flaim
            first, then use ChatGPT for read-only analysis grounded in your real
            fantasy context.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Connect ESPN, Yahoo, or Sleeper in{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                /leagues
              </Link>
              .
            </li>
            <li>
              Set a default league if you have more than one connected league.
            </li>
            <li>Open ChatGPT and use Flaim Fantasy.</li>
            <li>
              Start a fresh ChatGPT conversation and ask what leagues you have.
              See the{" "}
              <Link
                href="/guide/sports"
                className="text-primary hover:underline"
              >
                sports guide
              </Link>{" "}
              for example prompts.
            </li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">ChatGPT troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Flaim does not appear in ChatGPT: search for the exact app name,
                Flaim Fantasy, and confirm you are using a ChatGPT experience
                that supports Apps.
              </li>
              <li>
                ChatGPT cannot see any leagues after setup: go back to{" "}
                <Link href="/leagues" className="text-primary hover:underline">
                  /leagues
                </Link>{" "}
                and finish platform setup first.
              </li>
              <li>
                ChatGPT does not use Flaim automatically: start a fresh chat and
                explicitly ask about your connected fantasy league data.
              </li>
            </ul>
          </div>
        </section>

        {/* Claude */}
        <section id="claude" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Claude</h2>
          <p className="mb-4 text-muted-foreground">
            Anthropic has approved Flaim for its connector directory, but the
            public listing is still pending. Until then, Claude is an optional
            manual custom-connector path where your account supports it.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{" "}
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
              Add a custom connector and use{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                https://api.flaim.app/mcp
              </code>{" "}
              as the server URL.
            </li>
            <li>Authorize Flaim when the browser flow opens.</li>
            <li>
              Start a fresh Claude conversation for your first test. See the{" "}
              <Link
                href="/guide/sports"
                className="text-primary hover:underline"
              >
                sports guide
              </Link>{" "}
              for example prompts.
            </li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Claude troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Authorized successfully but returns no leagues: go back to{" "}
                <Link href="/leagues" className="text-primary hover:underline">
                  /leagues
                </Link>{" "}
                and finish platform setup first.
              </li>
              <li>
                Claude does not invoke Flaim on its own: start a fresh chat and
                be explicit about wanting your connected league data.
              </li>
              <li>
                The Claude UI moved: use Anthropic&apos;s latest connector
                settings flow, then come back to the same MCP URL.
              </li>
            </ul>
          </div>
        </section>

        {/* Perplexity */}
        <section id="perplexity" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Perplexity</h2>
          <p className="mb-4 text-muted-foreground">
            Perplexity invited Flaim into its curated connector onboarding, but
            publication is still pending. Its existing custom remote connector
            flow is an optional manual path that uses OAuth and Streamable HTTP.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open Perplexity&apos;s connector settings and choose to add a
              remote connector.
            </li>
            <li>
              Use{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                https://api.flaim.app/mcp
              </code>{" "}
              as the URL.
            </li>
            <li>Set authentication to OAuth.</li>
            <li>Set transport to Streamable HTTP.</li>
            <li>Authorize Flaim and start a fresh thread.</li>
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">
            Perplexity custom remote connectors require HTTPS. In some
            workspaces, an admin must enable custom remote connectors before
            members can add them.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            For Perplexity&apos;s current UI details, check{" "}
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
                Connector exists but returns auth or transport errors: confirm
                you used OAuth and Streamable HTTP.
              </li>
              <li>
                Connected but sees no leagues: finish platform setup in{" "}
                <Link href="/leagues" className="text-primary hover:underline">
                  /leagues
                </Link>{" "}
                first, then start a fresh thread.
              </li>
              <li>
                Multiple stale connectors from testing: delete the extras and
                keep one clean Flaim connector.
              </li>
            </ul>
          </div>
        </section>

        {/* Shared success */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              ChatGPT shows Flaim Fantasy as available; in manual MCP clients,
              the client shows Flaim as authorized.
            </li>
            <li>
              A fresh conversation can answer &ldquo;What leagues do I
              have?&rdquo; without failing auth.
            </li>
            <li>
              Follow-up questions about rosters, standings, or matchups work
              without another auth prompt.
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">
            Common issues across all AI apps
          </h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              Authorized before your leagues were linked: finish{" "}
              <Link
                href="/guide/platforms"
                className="text-primary hover:underline"
              >
                platform setup
              </Link>{" "}
              first, then start a fresh conversation.
            </li>
            <li>
              AI does not call Flaim automatically: start a fresh chat and
              explicitly ask about your connected fantasy league data.
            </li>
            <li>
              Keep{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                /leagues
              </Link>{" "}
              handy if you need to reconnect or change your defaults later.
            </li>
          </ul>
        </section>

        <div className="flex items-center gap-4 border-t pt-4 text-sm">
          <Link
            href="/guide/platforms"
            className="text-primary hover:underline"
          >
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
