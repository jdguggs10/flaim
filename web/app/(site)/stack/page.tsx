import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = {
  title: "Stack",
  description: "The tools and services behind Flaim.",
  robots: {
    index: false,
    follow: false,
  },
};

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

export default function StackPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-16 px-4">
        <section className="mb-10">
          <h1 className="text-3xl font-bold mb-4">Stack</h1>
          <p className="text-muted-foreground">
            The stack is intentionally boring in the best way. Open standards,
            edge workers, and tools that let a solo builder ship without turning
            every change into a project.
          </p>
        </section>

        <section className="grid gap-3">
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
        </section>

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
