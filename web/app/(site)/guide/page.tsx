import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Flaim Setup Guide",
  description:
    "Set up Flaim for ChatGPT-first fantasy sports analysis. Connect platforms, use Flaim Fantasy in ChatGPT Apps, and optionally configure MCP for Claude, Perplexity, or Gemini CLI.",
  alternates: {
    canonical: "https://flaim.app/guide",
  },
};

const guideCards = [
  {
    href: "/leagues",
    title: "Set Up Your Account",
    kicker: "Start here",
    body: "Connect ESPN, Yahoo, or Sleeper and choose the default league ChatGPT should use first.",
  },
  {
    href: "/guide/ai",
    title: "Use ChatGPT",
    kicker: "Primary AI path",
    body: "Use Flaim Fantasy in ChatGPT Apps. Manual MCP setup for Claude, Perplexity, and Gemini CLI lives here too.",
  },
  {
    href: "/guide/platforms",
    title: "Platform Setup",
    kicker: "ESPN, Yahoo, Sleeper",
    body: "Platform-specific setup and troubleshooting for syncing the leagues Flaim can read.",
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
            Set up your fantasy platforms first, then use Flaim Fantasy in
            ChatGPT Apps. Claude, Perplexity, and Gemini CLI remain optional
            manual MCP setup paths.
          </p>
          <p className="text-muted-foreground">
            ChatGPT is the main setup path for most users; the manual MCP
            details are here for alternate AI tools and developer testing.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {guideCards.map(({ href, title, kicker, body }) => (
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

        <section className="mt-10 rounded-lg border bg-muted/40 p-5">
          <h2 className="mb-2 text-lg font-semibold">Recommended order</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li>Sign in and connect at least one platform in /leagues.</li>
            <li>Set a default league so Flaim has a clear first context.</li>
            <li>Open ChatGPT and use Flaim Fantasy, or use manual MCP setup for Claude, Perplexity, and Gemini CLI.</li>
          </ol>
        </section>
      </div>
    </div>
  );
}
