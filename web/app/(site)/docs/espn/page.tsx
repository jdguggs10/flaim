import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ChevronDown, ExternalLink } from "lucide-react";

import { GuideStepNavigation } from "@/components/site/guide-step-navigation";
import { Button } from "@/components/ui/button";
import { CHROME_EXTENSION_URL } from "@/config/constants";

export const metadata: Metadata = {
  title: "Connect ESPN Fantasy to ChatGPT and Claude",
  description:
    "Connect your ESPN fantasy league to ChatGPT or Claude with Flaim Fantasy. Sync once with the free Flaim Chrome extension on a computer, then ask about your real team from anywhere.",
  alternates: {
    canonical: "https://flaim.app/docs/espn",
  },
};

type SetupStep = {
  title: string;
  body: string;
  link?: { href: string; label: string };
};

const SETUP_STEPS: readonly SetupStep[] = [
  {
    title: "Sign in to Flaim",
    body: "Open Flaim in Chrome and sign in to the Flaim account where you want your leagues to appear.",
  },
  {
    title: "Sign in to ESPN Fantasy",
    body: "In the same Chrome profile, open ESPN Fantasy and make sure you can open the league you want to connect.",
  },
  {
    title: "Install and open Flaim",
    body: "Install the Flaim ESPN Fantasy Connector. In Chrome, select the Extensions puzzle-piece menu near the address bar, then choose Flaim. You can pin it there for easier access.",
  },
  {
    title: "Sync to Flaim",
    body: "Choose Sync to Flaim in the popup. Keep the popup open until it shows the league result.",
  },
  {
    title: "Confirm your leagues",
    body: "Open Your Leagues and confirm the league name, your team, and the season.",
  },
  {
    title: "Add Flaim to ChatGPT or Claude",
    body: "Open Flaim Fantasy in ChatGPT or Claude, sign in with the same Flaim account, and ask what fantasy leagues you have.",
    link: { href: "/docs/ai", label: "AI app docs" },
  },
];

const ESPN_FAQS = [
  {
    question: "How do I connect my ESPN fantasy league to ChatGPT?",
    answer:
      "Install the free Flaim Chrome extension on a computer, sign in to Flaim and ESPN in the same Chrome profile, and choose Sync to Flaim. Then open Flaim Fantasy in ChatGPT and sign in with your Flaim account. Claude works the same way.",
  },
  {
    question: "I installed the extension but cannot find it",
    answer:
      "In Chrome, select the Extensions puzzle-piece menu near the address bar, then choose Flaim ESPN Fantasy Connector. You can pin it from that menu to keep it beside the address bar.",
  },
  {
    question: "I am signed in to Flaim, but the popup says I am signed out",
    answer:
      "Make sure flaim.app is signed in within the same Chrome profile where you installed the extension. Then close the popup completely and open it again from Chrome's Extensions menu.",
  },
  {
    question: "Flaim is signed in, but ESPN is not detected",
    answer:
      "Open ESPN Fantasy in the same Chrome profile as Flaim, sign in there, and confirm your league opens. Return to the Flaim popup and try Sync to Flaim again.",
  },
  {
    question: "Sync finished, but no leagues appeared",
    answer:
      "Open the league in ESPN Fantasy and confirm the correct ESPN account is active in this Chrome profile. Sync once more. If the result is still empty, open the info panel in the Flaim popup, choose Copy support info, and email it to support@flaim.app. It never includes your ESPN cookies or sign-in tokens.",
  },
  {
    question: "The league check did not finish",
    answer:
      "Your ESPN access may have saved even though the league check timed out or failed. Open Your Leagues to see whether anything was saved, then return to the popup and retry. If it keeps failing, copy the support info from the popup's info panel and email support@flaim.app.",
  },
  {
    question: "My connection stopped working",
    answer:
      "Open ESPN Fantasy in Chrome, make sure you are still signed in, then open the Flaim popup and sync again. ESPN can sign you out or you may have switched Chrome profiles.",
  },
  {
    question: "Can I set up ESPN from my phone?",
    answer:
      "No. Chrome extensions run on a computer. You can use Flaim on your phone after setup, but install and sync the ESPN connector in Google Chrome on a computer first.",
  },
] as const;

const HOW_TO_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "Connect an ESPN fantasy league to ChatGPT or Claude",
  dateModified: "2026-09-25",
  description:
    "Sync ESPN with the Flaim Chrome extension, then add Flaim Fantasy to ChatGPT or Claude.",
  step: SETUP_STEPS.map((step, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    name: step.title,
    text: step.body,
  })),
};

export default function EspnGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            HOW_TO_SCHEMA,
            {
              "@context": "https://schema.org",
              "@type": "FAQPage",
              mainEntity: ESPN_FAQS.map((faq) => ({
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
            Docs
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
            Connect your ESPN fantasy league to ChatGPT and Claude
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
            ChatGPT and Claude can read your ESPN league through Flaim Fantasy.
            ESPN needs the free Flaim Chrome extension once, on a computer.
            Yahoo and Sleeper don&apos;t. After that one sync, ask about your
            roster, matchup, and waiver wire from any device, including your
            phone.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a
                href={CHROME_EXTENSION_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                View in Chrome Web Store
                <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/leagues#platforms">Open Your Leagues</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Before you start
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Use one Chrome profile for both accounts
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            <article className="rounded-2xl border p-6">
              <h3 className="text-xl font-semibold">A computer with Chrome</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                The connector runs in Google Chrome on a computer. Phone
                browsers cannot run Chrome extensions.
              </p>
            </article>
            <article className="rounded-2xl border p-6">
              <h3 className="text-xl font-semibold">Your Flaim account</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Sign in to the Flaim account where you want the connected
                leagues to appear.
              </p>
            </article>
            <article className="rounded-2xl border p-6">
              <h3 className="text-xl font-semibold">Your ESPN Fantasy account</h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                Sign in to ESPN Fantasy and make sure the league you want is
                visible before you open the connector.
              </p>
              <a
                href="https://www.espn.com/fantasy/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center text-sm font-medium text-primary hover:underline"
              >
                Open ESPN Fantasy
                <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </article>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Set up ESPN
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Six steps from ESPN to ChatGPT or Claude
          </h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SETUP_STEPS.map((step, index) => (
              <article
                key={step.title}
                className="rounded-2xl border bg-background p-6"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Step {index + 1}
                </p>
                <h3 className="mt-3 text-xl font-semibold">{step.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {step.body}
                </p>
                {step.link ? (
                  <Link
                    href={step.link.href}
                    className="mt-3 inline-flex text-sm font-medium text-primary hover:underline"
                  >
                    {step.link.label}
                  </Link>
                ) : null}
              </article>
            ))}
          </div>
          <div className="mt-10">
            <h3 className="text-2xl font-semibold">What you will see</h3>
            <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
              These examples use a demo Flaim account, league, and team. Your
              names will appear in the same places.
            </p>
            <div className="mt-6 grid gap-5 md:grid-cols-2">
              <figure className="rounded-2xl border bg-background p-6">
                <Image
                  src="/media/espn/espn-extension-ready-to-sync-2026.png"
                  alt="Flaim ESPN connector ready to sync, showing the example Demo Manager account signed in and ESPN detected"
                  width={320}
                  height={428}
                  className="mx-auto h-auto w-full max-w-[320px] rounded-xl border"
                />
                <figcaption className="mt-4 text-sm leading-6 text-muted-foreground">
                  Before syncing, confirm that Flaim is signed in and ESPN is
                  detected in the Chrome profile you intend to use.
                </figcaption>
              </figure>
              <figure className="rounded-2xl border bg-background p-6">
                <Image
                  src="/media/espn/espn-leagues-confirmed-2026.png"
                  alt="Flaim ESPN connector after a confirmed sync, showing the example Sunday League and Your Leagues button"
                  width={320}
                  height={388}
                  className="mx-auto h-auto w-full max-w-[320px] rounded-xl border"
                />
                <figcaption className="mt-4 text-sm leading-6 text-muted-foreground">
                  After syncing, Flaim lists the current league it confirmed.
                  Choose Your Leagues to verify the details in Flaim.
                </figcaption>
              </figure>
            </div>
          </div>
          <div className="mt-8 rounded-2xl border bg-background p-6">
            <h3 className="text-xl font-semibold">Which account is which?</h3>
            <p className="mt-3 max-w-3xl leading-7 text-muted-foreground">
              The account shown in the Flaim popup is the Flaim account that
              receives your leagues. ESPN access comes from the ESPN account
              signed in to the same Chrome profile.
            </p>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Questions
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Where are you stuck?
          </h2>
          <div className="mt-8 space-y-3">
            {ESPN_FAQS.map((faq) => (
              <details
                key={faq.question}
                className="group rounded-xl border bg-background"
              >
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
            backHref="/docs/platforms"
            backLabel="Back to Platform Docs"
            nextHref="/docs/ai"
            nextLabel="Continue to AI App Docs"
          />
        </div>
      </section>
    </div>
  );
}
