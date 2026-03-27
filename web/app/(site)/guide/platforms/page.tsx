import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Fantasy Platform Setup: ESPN, Yahoo & Sleeper | Flaim',
  description:
    'Connect your ESPN, Yahoo, or Sleeper fantasy leagues to Flaim from /leagues. Step-by-step setup, troubleshooting, and success checks for each platform.',
  alternates: {
    canonical: 'https://flaim.app/guide/platforms',
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
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: 'Connect ESPN fantasy leagues to Flaim',
              description:
                'Sync your ESPN fantasy leagues using the Chrome extension or manual credentials, then verify they appear in Flaim.',
              step: [
                { '@type': 'HowToStep', name: 'Open /leagues', text: 'Sign in to Flaim and open https://flaim.app/leagues.' },
                { '@type': 'HowToStep', name: 'Sync ESPN', text: 'Use the Chrome extension to sync, or paste your SWID and ESPN_S2 cookies as a fallback.' },
                { '@type': 'HowToStep', name: 'Verify leagues', text: 'Confirm your ESPN leagues appear in /leagues before moving to AI setup.' },
              ],
            },
            {
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: 'Connect Yahoo fantasy leagues to Flaim',
              description:
                'Start Yahoo OAuth from /leagues, approve access, and wait for league discovery to finish.',
              step: [
                { '@type': 'HowToStep', name: 'Open /leagues', text: 'Sign in to Flaim and open https://flaim.app/leagues.' },
                { '@type': 'HowToStep', name: 'Authenticate Yahoo', text: 'Start Yahoo auth and approve Flaim access.' },
                { '@type': 'HowToStep', name: 'Verify leagues', text: 'Wait for discovery and confirm your Yahoo leagues appear.' },
              ],
            },
            {
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: 'Connect Sleeper fantasy leagues to Flaim',
              description:
                'Enter your exact Sleeper username in /leagues and wait for league discovery.',
              step: [
                { '@type': 'HowToStep', name: 'Open /leagues', text: 'Sign in to Flaim and open https://flaim.app/leagues.' },
                { '@type': 'HowToStep', name: 'Enter username', text: 'Enter your exact Sleeper username (not display name) and submit.' },
                { '@type': 'HowToStep', name: 'Verify leagues', text: 'Wait for discovery and confirm your Sleeper leagues appear.' },
              ],
            },
          ]),
        }}
      />
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">Fantasy Platform Setup</h1>
        <p className="mb-8 text-muted-foreground">
          Connect your fantasy platforms in{' '}
          <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> before
          adding Flaim to your AI assistant. Each platform connects differently, but the goal is
          the same: get your leagues visible in Flaim so your AI can use them.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">Before you start</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              Sign in to Flaim and open{' '}
              <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.
            </li>
            <li>Use the account that actually owns or participates in the leagues you want.</li>
            <li>
              Supported sports: football, baseball, basketball, and hockey (ESPN and Yahoo).
              Sleeper supports football and basketball.
            </li>
          </ul>
        </section>

        {/* ESPN */}
        <section id="espn" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">ESPN</h2>
          <p className="mb-4 text-muted-foreground">
            ESPN is the highest-friction setup because ESPN does not offer a public fantasy API.
            The Chrome extension is the cleanest path. Manual cookie entry exists as a fallback.
            Your ESPN credentials are never shared with AI providers.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{' '}
              <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and
              choose ESPN.
            </li>
            <li>
              Preferred: install the Flaim Chrome extension, sign in to fantasy.espn.com in that
              browser profile, then trigger Sync from the extension.
            </li>
            <li>
              Fallback: use the manual credential path in the ESPN card and paste your{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">SWID</code> and{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">ESPN_S2</code> values.
            </li>
            <li>
              If Flaim asks for league IDs, add the private leagues you care about and run
              verification again.
            </li>
            <li>Wait until your ESPN leagues show up before moving on to AI setup.</li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">ESPN troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Sync succeeds but no leagues show up: make sure you are logged into the correct
                ESPN account and try the sync again.
              </li>
              <li>
                Private league still missing: add the league ID manually from the ESPN flow in{' '}
                <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>.
              </li>
              <li>
                Credentials expire or become invalid later: rerun extension sync or replace the
                manual cookies.
              </li>
            </ul>
          </div>
        </section>

        {/* Yahoo */}
        <section id="yahoo" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Yahoo</h2>
          <p className="mb-4 text-muted-foreground">
            Yahoo is the simplest private-platform setup. Start OAuth from{' '}
            <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>,
            approve access, and wait for league discovery to finish.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{' '}
              <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and
              choose Yahoo.
            </li>
            <li>Start Yahoo authentication and approve Flaim&apos;s access request.</li>
            <li>
              Return to Flaim and wait for discovery to finish. Auth success does not mean your
              leagues are ready yet.
            </li>
            <li>Confirm that the Yahoo section shows leagues you can use.</li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Yahoo troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Auth completed but Flaim still looks disconnected: retry from{' '}
                <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>{' '}
                and make sure the popup or redirect fully finishes.
              </li>
              <li>
                Auth worked but zero leagues appear: confirm the Yahoo account has supported
                active leagues and reconnect.
              </li>
              <li>Yahoo worked before and stopped: reconnect to refresh access.</li>
            </ul>
          </div>
        </section>

        {/* Sleeper */}
        <section id="sleeper" className="mb-10 scroll-mt-20">
          <h2 className="mb-3 text-xl font-semibold">Sleeper</h2>
          <p className="mb-4 text-muted-foreground">
            Sleeper uses a public API, so there is no extension and no OAuth. The important part
            is using your exact username (not your display name) and knowing that Flaim supports
            football and basketball on Sleeper.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
            <li>
              Open{' '}
              <Link href="/leagues" className="text-primary hover:underline">/leagues</Link> and
              choose Sleeper.
            </li>
            <li>Enter your exact username and submit.</li>
            <li>Wait for discovery to finish and confirm leagues show up in Flaim.</li>
          </ol>
          <div className="mt-4 rounded-lg border bg-muted/50 p-4">
            <h3 className="mb-2 font-medium">Sleeper troubleshooting</h3>
            <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
              <li>
                Flaim says user not found: verify the exact username (not display name) and try
                again.
              </li>
              <li>
                Connected but no leagues appear: confirm the account has football or basketball
                leagues.
              </li>
              <li>
                Older leagues are missing: start by testing a current league first. Historical
                coverage through Sleeper&apos;s history chain may take time.
              </li>
            </ul>
          </div>
        </section>

        {/* Shared success + next steps */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">How to know it worked</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>
              Your platform connection in{' '}
              <Link href="/leagues" className="text-primary hover:underline">/leagues</Link>{' '}
              shows leagues you can use, not just a pending state.
            </li>
            <li>
              You can identify the league you want to analyze first.
            </li>
            <li>
              After{' '}
              <Link href="/guide/ai" className="text-primary hover:underline">
                connecting your AI
              </Link>
              , a fresh chat can answer &ldquo;What leagues do I have?&rdquo; without an auth
              error.
            </li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What happens next</h2>
          <p className="text-muted-foreground">
            Once your leagues are visible in Flaim,{' '}
            <Link href="/guide/ai" className="text-primary hover:underline">
              add Flaim to your AI assistant
            </Link>{' '}
            with{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              https://api.flaim.app/mcp
            </code>
            . Start a new chat and ask about your roster, matchup, or standings. If you use
            multiple leagues, name the one you want in your first prompt.
          </p>
        </section>

        <div className="flex items-center gap-4 border-t pt-4 text-sm">
          <Link href="/guide/ai" className="text-primary hover:underline">
            AI assistant setup &rarr;
          </Link>
          <Link href="/guide/sports" className="text-primary hover:underline">
            How Flaim analyzes sports &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
