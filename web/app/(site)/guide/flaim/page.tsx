import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Flaim Account Help",
  description:
    "Create your free Flaim account, sign in, manage your connected leagues, and get help with account access and privacy.",
  alternates: {
    canonical: "https://flaim.app/guide/flaim",
  },
};

const ACCOUNT_FAQS = [
  {
    question: "I already have a Flaim account",
    answer:
      "Choose Sign In instead of creating another account. Use the same email or sign-in method you used before so your existing league connections stay together.",
  },
  {
    question: "I cannot sign in",
    answer:
      "Return to Sign In and try the email or sign-in method you originally used. If you still cannot get in, email support@flaim.app and include the email address associated with your account.",
  },
  {
    question: "I signed in, but my leagues are missing",
    answer:
      "First make sure you signed in to the Flaim account you used before. Then open Your Leagues. If the platform is connected, sync or refresh it. If it is not connected, continue to Platform Help.",
  },
  {
    question: "Is my Flaim account the same as my fantasy account?",
    answer:
      "No. Your Flaim account keeps everything together, but ESPN, Yahoo, and Sleeper connect separately in Step 2. ChatGPT, Claude, and other AI apps connect separately in Step 3.",
  },
  {
    question: "How do I delete my account?",
    answer:
      "Email privacy@flaim.app to request complete account deletion. Flaim will permanently remove your stored account details, platform credentials, and league data within 30 days.",
  },
] as const;

const HOW_TO_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: "Create a Flaim account",
  dateModified: "2026-08-15",
  description:
    "Create a free Flaim account before connecting your fantasy leagues and AI app.",
  step: [
    "Open Flaim and choose Create Your Account.",
    "Complete the sign-up screen and continue to Your Leagues.",
    "Connect ESPN, Yahoo, or Sleeper in Step 2.",
  ].map((text, index) => ({
    "@type": "HowToStep",
    position: index + 1,
    text,
  })),
};

export default function FlaimGuidePage() {
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
              mainEntity: ACCOUNT_FAQS.map((faq) => ({
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
            Step 1 of 3
          </p>
          <h1 className="mt-4 max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl">
            Create your Flaim account
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
            Your free Flaim account keeps your fantasy leagues and AI
            connections together. Create it once, then move on to Your Leagues.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">Create Your Account</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/sign-in">Sign In</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Flaim help
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight">
            Start with the right account
          </h2>
          <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
            New users only need one Flaim account. Returning users should sign
            in to the account that already holds their league connections.
          </p>

          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <article className="flex flex-col rounded-2xl border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                New to Flaim
              </p>
              <h3 className="mt-3 text-2xl font-semibold">Create an account</h3>
              <p className="mt-3 flex-1 leading-7 text-muted-foreground">
                Create your free account, then Flaim will take you to Your
                Leagues so you can connect ESPN, Yahoo, or Sleeper.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link href="/sign-up">Create Your Account</Link>
              </Button>
              <details className="group mt-4 rounded-xl bg-muted/60">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium">
                  A little help
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  Creating the account is only Step 1. Your fantasy platforms
                  are connected separately in Step 2, and your AI app is
                  connected separately in Step 3.
                </p>
              </details>
            </article>

            <article className="flex flex-col rounded-2xl border p-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Returning to Flaim
              </p>
              <h3 className="mt-3 text-2xl font-semibold">Sign in</h3>
              <p className="mt-3 flex-1 leading-7 text-muted-foreground">
                Use your existing Flaim account so you return to the leagues
                and AI connections you already set up.
              </p>
              <Button asChild className="mt-6 w-full">
                <Link href="/sign-in">Sign In</Link>
              </Button>
              <details className="group mt-4 rounded-xl bg-muted/60">
                <summary className="flex cursor-pointer items-center justify-between gap-3 p-4 text-sm font-medium">
                  A little help
                  <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <p className="px-4 pb-4 text-sm leading-6 text-muted-foreground">
                  If your leagues are missing after sign-in, you may be in a
                  different Flaim account. Try the email or sign-in method you
                  originally used before reconnecting anything.
                </p>
              </details>
            </article>
          </div>

          <div className="mt-8 flex items-start gap-3 rounded-xl border bg-muted/40 p-5 text-sm text-muted-foreground">
            <ShieldCheck
              className="mt-0.5 h-5 w-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <p className="leading-6">
              Flaim is read-only. Your account can share your league info with
              the AI you authorize, but it cannot make trades, edit lineups, or
              change your fantasy leagues.
            </p>
          </div>
        </div>
      </section>

      <section className="border-y bg-muted/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">Account help</h2>
          <p className="mt-4 leading-7 text-muted-foreground">
            These fixes cover the most common Flaim account questions. ESPN,
            Yahoo, Sleeper, ChatGPT, and Claude have their own help pages in the
            next two steps.
          </p>

          <div className="mt-6 space-y-3">
            {ACCOUNT_FAQS.map((faq) => (
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

          <div className="mt-10 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/guide/platforms">Continue to Platform Help</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="mailto:support@flaim.app">Email Support</a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
