import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Inspirations",
  description:
    "Projects that shaped how Flaim was built. Focused scope, honest design, and respect for the user.",
  alternates: {
    canonical: "https://flaim.app/inspirations",
  },
};
import { ExternalLink } from "lucide-react";

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
    name: "espn-api",
    url: "https://github.com/cwendt94/espn-api",
    description: "Props to cwendt94 for making all this possible.",
  },
];

const stack = [
  {
    name: "MCP",
    description:
      "Model Context Protocol. The open standard that connects Flaim to AI assistants.",
    url: "https://modelcontextprotocol.io",
  },
  {
    name: "OAuth 2.1",
    description: "Authentication between your AI client and Flaim.",
    url: "https://oauth.net/2.1/",
  },
  {
    name: "Cloudflare Workers",
    description:
      "Runs the MCP server and all platform API clients at the edge.",
    url: "https://workers.cloudflare.com",
  },
  {
    name: "Hono",
    description: "Lightweight web framework powering the Workers.",
    url: "https://hono.dev",
  },
  {
    name: "Next.js",
    description: "App Router powers the web app.",
    url: "https://nextjs.org",
  },
  {
    name: "Vercel",
    description: "Hosts and deploys the web app.",
    url: "https://vercel.com",
  },
  {
    name: "Supabase",
    description:
      "PostgreSQL database for credentials, leagues, and OAuth tokens.",
    url: "https://supabase.com",
  },
  {
    name: "Clerk",
    description: "User authentication and session management.",
    url: "https://clerk.com",
  },
  {
    name: "TypeScript",
    description: "Everything is TypeScript, end to end.",
    url: "https://www.typescriptlang.org",
  },
];

export default function InspirationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-16 px-4">
        {/* Intro */}
        <section className="mb-12">
          <h1 className="text-3xl font-bold mb-4">Inspirations</h1>
          <div className="text-muted-foreground space-y-3">
            <p>
              Flaim is a side project, built in spare time, maintained for the
              long haul. The goal is simple: connect fantasy sports data to AI
              tools, and do it reliably.
            </p>
            <p>
              These are some projects that shaped how I think about building
              software. They share a common thread: focused scope, honest
              design, and respect for the user.
            </p>
          </div>
        </section>

        {/* Inspirations List */}
        <section className="space-y-8">
          {inspirations.map((item) => (
            <div key={item.name} className="border-b pb-6 last:border-b-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-lg font-semibold hover:text-primary transition-colors"
              >
                {item.name}
                <ExternalLink className="h-4 w-4" />
              </a>
              <p className="text-sm text-muted-foreground mt-2">
                {item.description}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-14 border-t pt-10">
          <h2 className="text-2xl font-bold mb-3">Built with</h2>
          <p className="text-muted-foreground mb-6">
            The stack is intentionally boring in the best way. Open standards,
            edge workers, and tools that let a solo builder ship without turning
            every change into a project.
          </p>
          <div className="grid gap-3">
            {stack.map(({ name, description, url }) => (
              <a
                key={name}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors"
              >
                <div className="inline-flex items-center gap-2 font-semibold">
                  {name}
                  <ExternalLink className="h-4 w-4" />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {description}
                </p>
              </a>
            ))}
          </div>
        </section>

        {/* Back link */}
        <section className="mt-12 pt-8 border-t">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to home
          </Link>
        </section>
      </div>
    </div>
  );
}
