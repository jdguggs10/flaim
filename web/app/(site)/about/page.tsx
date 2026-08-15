import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description:
    "Flaim is a free, solo-built project that connects real ESPN, Yahoo, and Sleeper fantasy leagues to ChatGPT and Claude. Meet Gerry and the projects that inspired it.",
  alternates: {
    canonical: "https://flaim.app/about",
  },
};

const inspirations = [
  {
    name: "Plain Text Sports",
    url: "https://plaintextsports.com",
    description: "The greatest sports score application of all time, period.",
  },
  {
    name: "CrazyNinjaOdds",
    url: "https://crazyninjaodds.com",
    description: "Crazy Ninja Mike is the 🐐.",
  },
  {
    name: "Pikkit",
    url: "https://pikkit.com",
    description: "Bet tracking done right. The real ones know.",
  },
  {
    name: "Mosaic",
    url: "https://www.threads.com/@jweingardt?igshid=NTc4MTIwNjQ2YQ==",
    description: "Baseball done right.",
  },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-2xl px-4 py-16">
        <section className="mb-12">
          <h1 className="mb-4 text-3xl font-bold">About Flaim</h1>
          <div className="space-y-3 text-muted-foreground">
            <p>
              I&apos;m Gerry, and I built Flaim because I want to win my fantasy
              baseball league again. Badly. I deserve more than one championship
              in 22 years, and I&apos;m doing everything I can to bring back the
              belt again. Nothing else matters.
            </p>
            <p>
              Flaim is free to use and my passion project. Please don&apos;t
              abuse it. Have fun.
            </p>
          </div>
          <nav
            aria-label="Founder links"
            className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-muted-foreground"
          >
            <span>On Threads:</span>
            <a
              href="https://www.threads.com/@flaim_app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              @flaim_app
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="https://www.threads.com/@jdguggs10"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              @jdguggs10
            </a>
          </nav>
        </section>

        <section aria-labelledby="inspirations-heading" className="space-y-8">
          <h2 id="inspirations-heading" className="text-2xl font-bold">
            Inspirations
          </h2>
          {inspirations.map((item) => (
            <div key={item.name} className="border-b pb-6 last:border-b-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-lg font-semibold transition-colors hover:text-primary"
              >
                {item.name}
                <ExternalLink className="h-4 w-4" />
              </a>
              <p className="mt-2 text-sm text-muted-foreground">
                {item.description}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-12 border-t pt-8">
          <Link
            href="/"
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← Back to home
          </Link>
        </section>
      </div>
    </div>
  );
}
