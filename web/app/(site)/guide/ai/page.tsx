import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
} from "@/lib/product-links";

export const metadata: Metadata = {
  title: "Use Flaim Fantasy with ChatGPT, Claude & Perplexity",
  description:
    "Connect your ESPN, Yahoo, or Sleeper fantasy leagues to ChatGPT, Claude, or Perplexity with Flaim. Get read-only analysis of your real roster, matchups, standings, waiver wire, transactions, and league history.",
  alternates: {
    canonical: "https://flaim.app/guide/ai",
  },
};

const AI_APPS = [
  {
    name: "ChatGPT",
    status: "Available now as Flaim Fantasy in ChatGPT.",
    description:
      "Connect your leagues in Flaim, open Flaim Fantasy in ChatGPT, authorize your account, and start asking about your league.",
    href: CHATGPT_APP_URL,
    cta: "Open Flaim Fantasy in ChatGPT",
    external: true,
  },
  {
    name: "Claude",
    status: "Available now in Claude's connector directory.",
    description:
      "Open Flaim in Claude, authorize your Flaim account, and ask about your connected fantasy league data.",
    href: CLAUDE_CONNECTOR_DIRECTORY_URL,
    cta: "Open Flaim in Claude",
    external: true,
  },
  {
    name: "Perplexity",
    status: "Available through Perplexity's remote connector settings; curated publication is pending.",
    description:
      "Add Flaim to Perplexity, authorize your Flaim account, and use your connected league alongside Perplexity's research.",
    href: "#perplexity",
    cta: "Set Up Perplexity",
    external: false,
  },
] as const;

const SHARED_SETUP = [
  {
    title: "Create your Flaim account",
    body: "Create your free account so Flaim can securely link your leagues to your AI app.",
  },
  {
    title: "Connect your fantasy leagues",
    body: "Connect ESPN, Yahoo, or Sleeper from Your Leagues and wait for Flaim to discover your leagues.",
  },
  {
    title: "Connect your AI app",
    body: 'Open Flaim in ChatGPT, Claude, or Perplexity, authorize your account, and ask, “What fantasy leagues do I have?”',
  },
] as const;

const SHARED_FAQS = [
  {
    question: "My AI cannot see any leagues",
    answer:
      "Return to Your Leagues and confirm that ESPN, Yahoo, or Sleeper is connected and that Flaim discovered the league you want to use.",
  },
  {
    question: "My AI is not using Flaim automatically",
    answer:
      "Start a fresh conversation and explicitly ask the AI to use Flaim or your connected fantasy league data.",
  },
  {
    question: "I connected my AI before my fantasy platform",
    answer:
      "Finish connecting your fantasy platform first, then return to the AI app and start a fresh conversation.",
  },
  {
    question: "Can my AI change my league?",
    answer:
      "No. Flaim cannot make trades, add or drop players, edit lineups, or change settings in ESPN, Yahoo, or Sleeper.",
  },
] as const;

const HOW_TO_SCHEMAS = [
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Use Flaim Fantasy in ChatGPT",
    dateModified: "2026-08-03",
    description:
      "Connect your fantasy leagues in Flaim, then use Flaim Fantasy in ChatGPT for read-only league analysis.",
    step: [
      "Create your Flaim account.",
      "Connect ESPN, Yahoo, or Sleeper in Your Leagues.",
      "Open Flaim Fantasy in ChatGPT, authorize Flaim, and ask what leagues you have.",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Use Flaim Fantasy in Claude",
    dateModified: "2026-08-09",
    description:
      "Open Flaim from Claude's connector directory and authorize it for read-only fantasy league access.",
    step: [
      "Create your Flaim account.",
      "Connect ESPN, Yahoo, or Sleeper in Your Leagues.",
      "Open Flaim in Claude's connector directory, authorize Flaim, and ask what leagues you have.",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Connect Flaim to Perplexity",
    dateModified: "2026-08-03",
    description:
      "Add Flaim as a Perplexity remote connector with OAuth authentication and Streamable HTTP transport.",
    step: [
      "Create your Flaim account.",
      "Connect ESPN, Yahoo, or Sleeper in Your Leagues.",
      "Add Flaim in Perplexity with https://api.flaim.app/mcp, choose OAuth and Streamable HTTP, authorize Flaim, and ask what leagues you have.",
    ],
  },
].map((howTo) => ({
  ...howTo,
  step: howTo.step.map((text, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    text,
  })),
}));

export default function AiGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            ...HOW_TO_SCHEMAS,
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: SHARED_FAQS.map((faq) => ({
                "@type": "Question",
                name: faq.question,
                acceptedAnswer: {
                  "@type": "Answer",
                  text: faq.answer,
                },
              })),
            },
          ]),
        }}
      />

      <section className="border-b px-4 py-16 sm:px-6 md:py-20 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Step 3 of 3
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
            Use your real fantasy leagues in the AI you already use
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
            Connect your leagues to Flaim once, then ask ChatGPT, Claude, or
            Perplexity about your actual roster, matchups, standings, free
            agents, transactions, league settings, and history.
          </p>
          <p className="mt-5 font-medium">
            Free. Read-only. No screenshots or copy-pasting.
          </p>
          <Button asChild size="lg" className="mt-8">
            <Link href="/leagues">Connect Your Leagues</Link>
          </Button>
        </div>
      </section>

      <section className="px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Choose your AI app
          </h2>
          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {AI_APPS.map((app) => (
              <article key={app.name} className="flex flex-col rounded-2xl border p-5">
                <h3 className="text-xl font-semibold">{app.name}</h3>
                <p className="mt-3 text-sm font-medium text-foreground/80">
                  {app.status}
                </p>
                <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
                  {app.description}
                </p>
                <Button asChild variant="outline" className="mt-6 w-full">
                  {app.external ? (
                    <a href={app.href} target="_blank" rel="noopener noreferrer">
                      {app.cta}
                      <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                    </a>
                  ) : (
                    <Link href={app.href}>
                      {app.cta}
                      <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                    </Link>
                  )}
                </Button>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="custom-connectors"
        className="scroll-mt-24 border-y bg-muted/50 px-4 py-14 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-5xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Three steps. Then start asking.
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Create your account, connect your fantasy leagues, then connect your
            AI app. Every supported AI app uses the same leagues saved in Flaim.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {SHARED_SETUP.map((step, index) => (
              <div key={step.title} className="rounded-2xl border bg-background p-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {index + 1}
                </div>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="chatgpt" className="scroll-mt-24 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              ChatGPT
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Use Flaim Fantasy in ChatGPT
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Flaim Fantasy is available in ChatGPT. Your Flaim account
              supplies the connected league data; ChatGPT handles the
              conversation and analysis.
            </p>
          </div>
          <div className="rounded-2xl border p-5">
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
              <li>Create your Flaim account.</li>
              <li>Connect ESPN, Yahoo, or Sleeper in Your Leagues.</li>
              <li>
                Open Flaim Fantasy in ChatGPT, authorize Flaim, and start a
                fresh chat by asking what leagues you have.
              </li>
            </ol>
            <h3 className="mt-6 font-semibold">Try asking:</h3>
            <ul className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <li>Grade my fantasy football team.</li>
              <li>Who should I add and drop?</li>
              <li>Who is winning my matchup?</li>
              <li>What is the biggest weakness on my roster?</li>
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              See more connected-roster examples in the{" "}
              <Link href="/fantasy-football" className="text-primary hover:underline">
                fantasy football analysis guide
              </Link>
              .
            </p>
            <div className="mt-6 rounded-xl bg-muted/60 p-4">
              <h3 className="font-semibold">ChatGPT troubleshooting</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  If Flaim does not appear, search for the exact name{" "}
                  <strong>Flaim Fantasy</strong>.
                </li>
                <li>
                  If ChatGPT cannot see any leagues, return to Your Leagues and
                  finish connecting a fantasy platform.
                </li>
                <li>
                  If ChatGPT does not choose Flaim automatically, start a fresh
                  chat and explicitly ask about your connected fantasy league.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section
        id="claude"
        className="scroll-mt-24 border-y bg-muted/50 px-4 py-14 sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Claude
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Use Flaim Fantasy in Claude
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Flaim is available in Claude&apos;s connector directory. Connect your
              fantasy platforms in Flaim first, then open Flaim in Claude and
              authorize your account.
            </p>
          </div>
          <div className="rounded-2xl border bg-background p-5">
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
              <li>
                Create your Flaim account.
              </li>
              <li>
                Connect ESPN, Yahoo, or Sleeper in Your Leagues.
              </li>
              <li>
                Open{" "}
                <a
                  href={CLAUDE_CONNECTOR_DIRECTORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Claude&apos;s connector directory
                </a>
                , find Flaim, authorize your account, and start a fresh
                conversation by asking what leagues you have.
              </li>
            </ol>
            <div className="mt-6 rounded-xl bg-muted/60 p-4">
              <h3 className="font-semibold">Claude troubleshooting</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  If Claude connects but returns no leagues, finish
                  fantasy-platform setup in Your Leagues.
                </li>
                <li>
                  If Claude does not use Flaim automatically, start a fresh
                  conversation and explicitly ask it to use your connected
                  league data.
                </li>
                <li>
                  If the directory does not open to Flaim directly, search for
                  the exact name <strong>Flaim Fantasy</strong>.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section
        id="perplexity"
        className="scroll-mt-24 px-4 py-14 sm:px-6 lg:px-8"
      >
        <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Perplexity
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">
              Connect Flaim to Perplexity
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              Perplexity can use Flaim as a remote connector, combining your
              actual fantasy league context with its research tools.
            </p>
          </div>
          <div className="rounded-2xl border p-5">
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-6 text-muted-foreground">
              <li>
                Create your Flaim account.
              </li>
              <li>
                Connect ESPN, Yahoo, or Sleeper in Your Leagues.
              </li>
              <li>
                Open Perplexity&apos;s connector settings, add{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  https://api.flaim.app/mcp
                </code>
                , choose OAuth authentication and Streamable HTTP transport,
                authorize Flaim, and start a fresh thread by asking what
                leagues you have.
              </li>
            </ol>
            <div className="mt-6 rounded-xl bg-muted/60 p-4">
              <h3 className="font-semibold">Perplexity troubleshooting</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
                <li>
                  If the connection reports an authentication or transport
                  error, confirm OAuth and Streamable HTTP are selected.
                </li>
                <li>
                  If Perplexity connects but returns no leagues, finish
                  fantasy-platform setup in Your Leagues.
                </li>
                <li>
                  If testing created duplicate Flaim connectors, remove the
                  extras and keep one authorized connection.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Ask one simple question first
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Start a new conversation and ask, &ldquo;What fantasy leagues do I
            have?&rdquo; A successful connection should return your current
            connected leagues without another authorization prompt.
          </p>
          <p className="mt-3 leading-7 text-muted-foreground">
            After that, try a roster, matchup, standings, waiver, transaction,
            or league-history question.
          </p>

          <h2 className="mt-12 text-2xl font-bold tracking-tight">
            Shared troubleshooting
          </h2>
          <div className="mt-6 space-y-3">
            {SHARED_FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border bg-background">
                <summary className="flex cursor-pointer items-center justify-between gap-4 p-4 font-medium">
                  {faq.question}
                  <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Give your AI the league context it has been missing
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Connect ESPN, Yahoo, or Sleeper to Flaim, then ask about the team you
            actually manage.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/leagues">Connect Your Leagues</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/guide/platforms">Fantasy Platform Help</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
