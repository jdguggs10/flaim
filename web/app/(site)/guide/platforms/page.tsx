import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Fantasy Platform Setup: ESPN, Yahoo & Sleeper",
  description:
    "Connect your ESPN, Yahoo, or Sleeper fantasy leagues to Flaim. Follow the setup, troubleshooting, and success checks for each platform.",
  alternates: {
    canonical: "https://flaim.app/guide/platforms",
  },
};

export default function PlatformsGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            {
              "@context": "https://schema.org",
              "@type": "HowTo",
              name: "Connect ESPN fantasy leagues to Flaim",
              dateModified: "2026-05-17",
              description:
                "Sync your ESPN fantasy leagues using the Flaim Chrome extension, then verify they appear in Flaim.",
              step: [
                {
                  "@type": "HowToStep",
                  name: "Open /leagues",
                  text: "Sign in to Flaim and open https://flaim.app/leagues.",
                },
                {
                  "@type": "HowToStep",
                  name: "Sync ESPN",
                  text: "Use the Flaim Chrome extension to sync ESPN from the browser profile that is signed in to fantasy.espn.com.",
                },
                {
                  "@type": "HowToStep",
                  name: "Verify leagues",
                  text: "Confirm your ESPN leagues appear in /leagues before moving to AI setup.",
                },
              ],
            },
            {
              "@context": "https://schema.org",
              "@type": "HowTo",
              name: "Connect Yahoo fantasy leagues to Flaim",
              dateModified: "2026-05-17",
              description:
                "Start Yahoo sign-in from your leagues page, approve access, and wait for league discovery to finish.",
              step: [
                {
                  "@type": "HowToStep",
                  name: "Open /leagues",
                  text: "Sign in to Flaim and open https://flaim.app/leagues.",
                },
                {
                  "@type": "HowToStep",
                  name: "Connect Yahoo",
                  text: "Start Yahoo auth and approve Flaim access.",
                },
                {
                  "@type": "HowToStep",
                  name: "Verify leagues",
                  text: "Wait for discovery and confirm your Yahoo leagues appear.",
                },
              ],
            },
            {
              "@context": "https://schema.org",
              "@type": "HowTo",
              name: "Connect Sleeper fantasy leagues to Flaim",
              dateModified: "2026-05-17",
              description:
                "Enter your exact Sleeper username in /leagues and wait for league discovery.",
              step: [
                {
                  "@type": "HowToStep",
                  name: "Open /leagues",
                  text: "Sign in to Flaim and open https://flaim.app/leagues.",
                },
                {
                  "@type": "HowToStep",
                  name: "Enter username",
                  text: "Enter your exact Sleeper username (not display name) and submit.",
                },
                {
                  "@type": "HowToStep",
                  name: "Verify leagues",
                  text: "Wait for discovery and confirm your Sleeper leagues appear.",
                },
              ],
            },
          ]),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Setup step 2 of 3
        </p>
        <h1 className="mb-4 mt-3 text-3xl font-bold">
          Connect Your Fantasy Leagues
        </h1>
        <p className="mb-4 text-lg font-medium text-foreground">
          Flaim connects to ESPN with the Chrome extension, Yahoo with a secure
          sign-in, and Sleeper with your username. Start on{" "}
          <Link href="/leagues" className="text-primary hover:underline">
            your leagues page
          </Link>
          .
        </p>
        <p className="text-xs text-muted-foreground">Last updated August 2026</p>
        <p className="mt-4 mb-8 text-muted-foreground">
          Connect your fantasy platforms in{" "}
          <Link href="/leagues" className="text-primary hover:underline">
            your leagues page
          </Link>{" "}
          before connecting your AI app. Each platform connects differently,
          but the goal is the same: get your leagues visible in Flaim so your
          AI is using the right fantasy account.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              Sign in to Flaim and open{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                your leagues page
              </Link>
              .
            </li>
            <li>
              Use the account that actually owns or participates in the leagues
              you want.
            </li>
            <li>
              Supported sports: football, baseball, basketball, and hockey (ESPN
              and Yahoo). Sleeper supports football and basketball.
            </li>
          </ul>
        </section>

        {/* ESPN */}
        <section id="espn" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">ESPN</h2>
          <p className="mb-4 text-muted-foreground">
            Connect ESPN with Flaim&apos;s Chrome extension. Your ESPN
            credentials are never shared with AI providers.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                your leagues page
              </Link>{" "}
              and choose ESPN.
            </li>
            <li>
              Install the Flaim Chrome extension, sign in to fantasy.espn.com
              in that browser profile, then trigger Sync from the extension.
            </li>
            <li>
              Use the extension whenever you need to update ESPN credentials,
              refresh leagues, discover seasons, or manage a different ESPN
              account.
            </li>
            <li>
              Wait until your ESPN leagues show up before moving on to{" "}
              <Link href="/guide/ai" className="text-primary hover:underline">
                ChatGPT setup
              </Link>
              .
            </li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">ESPN troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Sync succeeds but no leagues show up: make sure you are logged
                into the correct ESPN account and try the sync again.
              </li>
            </ul>
          </div>
        </section>

        {/* Yahoo */}
        <section id="yahoo" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Yahoo</h2>
          <p className="mb-4 text-muted-foreground">
            Yahoo connects through a secure sign-in. Start from{" "}
            <Link href="/leagues" className="text-primary hover:underline">
              your leagues page
            </Link>
            , approve access, and wait for league discovery to finish.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                your leagues page
              </Link>{" "}
              and choose Yahoo.
            </li>
            <li>
              Sign in to Yahoo and approve Flaim&apos;s access request.
            </li>
            <li>
              Return to Flaim and wait for discovery to finish. Completing the
              sign-in does not mean your leagues are ready yet.
            </li>
            <li>Confirm that the Yahoo section shows leagues you can use.</li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Yahoo troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Sync leagues pulls the latest league list using the current
                Yahoo connection. Reconnect Yahoo opens Yahoo sign-in again.
              </li>
              <li>
                Temporarily unavailable means Yahoo is asking Flaim to wait
                before another sync. Try again after the suggested wait, or
                reconnect Yahoo if it keeps happening.
              </li>
              <li>
                Yahoo sign-in completed but Flaim still looks disconnected:
                retry from{" "}
                <Link href="/leagues" className="text-primary hover:underline">
                  your leagues page
                </Link>{" "}
                and make sure the popup or redirect fully finishes.
              </li>
              <li>
                No leagues appear after sign-in: confirm the Yahoo account has
                supported active leagues and reconnect.
              </li>
              <li>
                Yahoo worked before and stopped: reconnect Yahoo to repair the
                stored connection.
              </li>
            </ul>
          </div>
        </section>

        {/* Sleeper */}
        <section id="sleeper" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Sleeper</h2>
          <p className="mb-4 text-muted-foreground">
            Sleeper connects with your username, so there is no extension or
            additional sign-in. Use your exact username, not your display name.
            Flaim supports football and basketball on Sleeper.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                your leagues page
              </Link>{" "}
              and choose Sleeper.
            </li>
            <li>Enter your exact username and submit.</li>
            <li>
              Wait for discovery to finish and confirm leagues show up in Flaim.
            </li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Sleeper troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Flaim says user not found: verify the exact username (not
                display name) and try again.
              </li>
              <li>
                Connected but no leagues appear: confirm the account has
                football or basketball leagues.
              </li>
              <li>
                Older leagues are missing: start by testing a current league
                first. Older Sleeper seasons may take time to appear.
              </li>
            </ul>
          </div>
        </section>

        {/* Shared success + next steps */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              Your platform connection in{" "}
              <Link href="/leagues" className="text-primary hover:underline">
                your leagues page
              </Link>{" "}
              shows leagues you can use, not just a still-syncing state.
            </li>
            <li>You can identify the league you want to analyze first.</li>
            <li>
              After you open Flaim Fantasy in{" "}
              <Link href="/guide/ai" className="text-primary hover:underline">
                ChatGPT
              </Link>
              , a fresh chat can answer &ldquo;What leagues do I have?&rdquo;
              without an auth error.
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">
            Next: connect your AI app
          </h2>
          <p className="text-muted-foreground">
            Once your leagues are visible in Flaim,{" "}
            <Link href="/guide/ai" className="text-primary hover:underline">
              use Flaim Fantasy in ChatGPT
            </Link>{" "}
            for read-only fantasy analysis. Start a new chat and ask about your
            roster, matchup, or standings. If you use multiple leagues, name
            the one you want in your first prompt.
          </p>
        </section>

        <div className="flex items-center gap-4 border-t pt-4 text-sm">
          <Link href="/guide/ai" className="text-primary hover:underline">
            Continue to step 3: Connect your AI &rarr;
          </Link>
          <Link href="/guide/sports" className="text-primary hover:underline">
            How Flaim analyzes sports &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
