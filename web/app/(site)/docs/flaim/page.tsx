import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { GuideStepNavigation } from "@/components/site/guide-step-navigation";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Create Your Flaim Account",
  description:
    "Create your free Flaim account, sign in, manage your connected leagues, and find answers about account access and privacy.",
  alternates: {
    canonical: "https://flaim.app/docs/flaim",
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
      "First make sure you signed in to the Flaim account you used before. Then open Your Leagues. If the platform is connected, sync or refresh it. If it is not connected, continue to the platform docs.",
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

      <section className="border-b bg-muted/50 px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight">Account FAQs</h2>

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

          <GuideStepNavigation
            backHref="/docs"
            backLabel="Back to Docs"
            nextHref="/docs/platforms"
            nextLabel="Continue to Platform Docs"
          />
        </div>
      </section>
    </div>
  );
}
