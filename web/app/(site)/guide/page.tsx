import type { Metadata } from "next";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import Link from "next/link";
import { Check, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StepConnectAI } from "@/components/site/StepConnectAI";
import { StepConnectPlatforms } from "@/components/site/StepConnectPlatforms";

export const metadata: Metadata = {
  title: "Flaim Setup Guide",
  description:
    "Set up Flaim for fantasy sports analysis in ChatGPT. Connect ESPN, Yahoo, or Sleeper, then use Flaim Fantasy in ChatGPT.",
  alternates: {
    canonical: "https://flaim.app/guide",
  },
};

const detailCards = [
  {
    href: "/guide/platforms",
    title: "Platform Setup",
    kicker: "ESPN, Yahoo, Sleeper",
    body: "Platform-specific setup and troubleshooting for syncing the leagues Flaim can read.",
  },
  {
    href: "/guide/ai",
    title: "ChatGPT Setup",
    kicker: "Primary AI path",
    body: "How to use Flaim Fantasy in ChatGPT after your leagues are connected.",
  },
  {
    href: "/guide/sports",
    title: "Sports Coverage",
    kicker: "What Flaim can analyze",
    body: "Supported sports, read-only tools, and example prompts for roster, matchup, waiver, and standings analysis.",
  },
];

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <div className="mb-10 space-y-4">
          <h1 className="text-3xl font-bold">Flaim Setup Guide</h1>
          <p className="text-lg font-medium text-foreground">
            Connect ChatGPT to ESPN, Yahoo, and Sleeper in three steps.
          </p>
          <p className="text-muted-foreground">
            Start with your Flaim account, connect the leagues you want ChatGPT
            to understand, then open Flaim Fantasy in ChatGPT and ask about your
            real fantasy context.
          </p>
        </div>

        <section className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                1
              </div>
              <h2 className="text-lg font-semibold">Create Account</h2>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              Sign in so Flaim has a secure place to store your connected
              platforms, discovered leagues, and default league choices.
            </p>
            <SignedOut>
              <Button asChild className="w-full">
                <Link href="/sign-up">
                  <User className="mr-2 h-4 w-4" />
                  Create Account
                </Link>
              </Button>
            </SignedOut>
            <SignedIn>
              <div className="flex items-center gap-2 text-sm font-medium text-success">
                <Check className="h-4 w-4" />
                Signed in
              </div>
            </SignedIn>
          </Card>

          <StepConnectPlatforms />

          <StepConnectAI />

          <p className="pt-2 text-center text-sm text-muted-foreground">
            Boom, you&apos;re done. Start a fresh ChatGPT conversation and ask
            Flaim Fantasy what leagues it can see.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="mb-4 text-xl font-semibold">Need more detail?</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {detailCards.map(({ href, title, kicker, body }) => (
              <Link
                key={href}
                href={href}
                className="rounded-lg border bg-background p-5 transition-colors hover:bg-muted/50"
              >
                <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">
                  {kicker}
                </p>
                <h2 className="mb-2 text-lg font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground">{body}</p>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
