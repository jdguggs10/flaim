import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GuideStepNavigation } from "@/components/site/guide-step-navigation";
import {
  CHATGPT_APP_URL,
  CLAUDE_CONNECTOR_DIRECTORY_URL,
  FLAIM_MCP_URL,
  PERPLEXITY_CONNECTOR_HELP_URL,
  PERPLEXITY_CONNECTOR_SETTINGS_URL,
} from "@/lib/product-links";

export const metadata: Metadata = {
  title: "Connect Flaim to ChatGPT, Claude & Perplexity",
  description:
    "Connect Flaim Fantasy to ChatGPT or Claude, or add Flaim to Perplexity as a custom connector. Ask about your real ESPN, Yahoo, or Sleeper leagues.",
  alternates: {
    canonical: "https://flaim.app/guide/ai",
  },
};

const CONNECTION_FAQS = [
  {
    question: "My AI cannot see any leagues",
    answer:
      "Open Your Leagues in Flaim and confirm that ESPN, Yahoo, or Sleeper is connected. Then return to your AI and start a new conversation.",
  },
  {
    question: "My AI is not using Flaim",
    answer:
      "Start a new conversation and ask it to use Flaim Fantasy for your question. You may need to choose Flaim from the AI app's plugin or connector menu first.",
  },
  {
    question: "Can Flaim change my league?",
    answer:
      "No. Flaim is read-only. It cannot make trades, add or drop players, edit lineups, or change settings in ESPN, Yahoo, or Sleeper.",
  },
] as const;

const HOW_TO_SCHEMAS = [
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Use Flaim Fantasy in ChatGPT",
    dateModified: "2026-08-15",
    description:
      "Open the Flaim Fantasy plugin in ChatGPT and connect your Flaim account.",
    step: [
      "Connect your ESPN, Yahoo, or Sleeper leagues to Flaim.",
      "Open the Flaim Fantasy plugin in ChatGPT and choose Try in chat.",
      "Authorize your Flaim account, then ask what fantasy leagues you have.",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Use Flaim Fantasy in Claude",
    dateModified: "2026-08-15",
    description:
      "Open Flaim Fantasy in Claude's connector directory and connect your Flaim account.",
    step: [
      "Connect your ESPN, Yahoo, or Sleeper leagues to Flaim.",
      "Open Flaim Fantasy in Claude's connector directory and choose Connect.",
      "Authorize your Flaim account, then ask what fantasy leagues you have.",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Connect Flaim Fantasy to Perplexity",
    dateModified: "2026-08-15",
    description:
      "Add Flaim Fantasy to Perplexity as a custom remote connector.",
    step: [
      "Connect your ESPN, Yahoo, or Sleeper leagues to Flaim.",
      "In Perplexity, open Account settings, choose Connectors, and add a custom remote connector.",
      "Name it Flaim Fantasy and enter " + FLAIM_MCP_URL + ".",
      "Choose OAuth and Streamable HTTP, accept the acknowledgement, and add the connector.",
      "Open the Flaim Fantasy connector, authorize your account, and ask what fantasy leagues you have.",
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
              mainEntity: CONNECTION_FAQS.map((faq) => ({
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
            Connect Flaim to your AI
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
            Connect your leagues first. Then open Flaim Fantasy in ChatGPT or
            Claude, or add it to Perplexity as a custom connector.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/leagues">First Connect Your Leagues</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/guide/platforms">Fantasy Platform Help</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Direct links
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            ChatGPT and Claude
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Open Flaim Fantasy from either directory, connect your account, and
            start asking about your real leagues.
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <article className="flex flex-col rounded-2xl border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                ChatGPT Plugin
              </p>
              <h3 className="mt-3 text-2xl font-semibold">
                Flaim Fantasy in ChatGPT
              </h3>
              <p className="mt-3 flex-1 leading-7 text-muted-foreground">
                Open the Flaim Fantasy plugin, choose Try in chat, and authorize
                your Flaim account if asked.
              </p>
              <Button asChild className="mt-6 w-full">
                <a href={CHATGPT_APP_URL} target="_blank" rel="noopener noreferrer">
                  Open in ChatGPT
                  <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
              <details className="group mt-4 rounded-xl bg-muted/60">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium">
                  A little help
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  If ChatGPT does not open Flaim automatically, choose Flaim
                  Fantasy from the plugin menu or ask ChatGPT to use Flaim for
                  your fantasy league question.
                </p>
              </details>
            </article>

            <article className="flex flex-col rounded-2xl border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Claude Connector
              </p>
              <h3 className="mt-3 text-2xl font-semibold">
                Flaim Fantasy in Claude
              </h3>
              <p className="mt-3 flex-1 leading-7 text-muted-foreground">
                Open Flaim Fantasy in Claude&apos;s connector directory and
                connect your Flaim account.
              </p>
              <Button asChild className="mt-6 w-full">
                <a
                  href={CLAUDE_CONNECTOR_DIRECTORY_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open in Claude
                  <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                </a>
              </Button>
              <details className="group mt-4 rounded-xl bg-muted/60">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium">
                  A little help
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  Claude shows Flaim Fantasy as Connected when it is ready. If
                  it does not use Flaim automatically, ask Claude to use Flaim
                  for your fantasy league question.
                </p>
              </details>
            </article>
          </div>
        </div>
      </section>

      <section
        id="custom-connectors"
        className="scroll-mt-24 border-y bg-muted/50 px-4 py-16 sm:px-6 lg:px-8"
      >
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Custom connectors
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Other AI apps, like Perplexity
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            Flaim uses Model Context Protocol (MCP), so you can add it to AI
            apps that support remote MCP connectors with OAuth and Streamable
            HTTP. Perplexity is one example.
          </p>

          <div className="mt-8 rounded-2xl border bg-background p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="max-w-2xl">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Example setup
                </p>
                <h3 className="mt-3 text-2xl font-semibold">Perplexity</h3>
                <p className="mt-3 leading-7 text-muted-foreground">
                  Add a remote connector named Flaim Fantasy, then authorize
                  your Flaim account. Availability may depend on your
                  Perplexity account or workspace settings.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-3">
                <Button asChild>
                  <a
                    href={PERPLEXITY_CONNECTOR_SETTINGS_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open Perplexity Settings
                    <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a
                    href={PERPLEXITY_CONNECTOR_HELP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Perplexity Instructions
                    <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
                  </a>
                </Button>
              </div>
            </div>

            <ol className="mt-7 grid gap-4 text-sm leading-6 text-muted-foreground md:grid-cols-2">
              <li className="rounded-xl bg-muted/60 p-4">
                <strong className="block text-foreground">1. Add a connector</strong>
                In Account settings, open Connectors, choose Custom connector,
                then choose Remote.
              </li>
              <li className="rounded-xl bg-muted/60 p-4">
                <strong className="block text-foreground">2. Enter Flaim</strong>
                Name it Flaim Fantasy and use this address:{" "}
                <code className="break-all rounded bg-background px-1 py-0.5 text-xs">
                  {FLAIM_MCP_URL}
                </code>
                .
              </li>
              <li className="rounded-xl bg-muted/60 p-4">
                <strong className="block text-foreground">
                  3. Choose the connection
                </strong>
                Select OAuth for authentication and Streamable HTTP for the
                connection type. Accept the acknowledgement and choose Add.
              </li>
              <li className="rounded-xl bg-muted/60 p-4">
                <strong className="block text-foreground">4. Authorize Flaim</strong>
                Open the new Flaim Fantasy connector and sign in to your Flaim
                account when Perplexity asks.
              </li>
            </ol>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">
            Check your connection
          </h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            Start a new conversation and ask, &ldquo;What fantasy leagues do I
            have?&rdquo; Flaim should return the leagues connected to your account.
          </p>

          <h2 className="mt-12 text-2xl font-bold tracking-tight">
            Connection help
          </h2>
          <div className="mt-6 space-y-3">
            {CONNECTION_FAQS.map((faq) => (
              <details key={faq.question} className="group rounded-xl border">
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

          <GuideStepNavigation
            backHref="/guide/platforms"
            backLabel="Back to Platform Help"
            nextHref="/leagues"
            nextLabel="Open Your Leagues"
          />
        </div>
      </section>
    </div>
  );
}
