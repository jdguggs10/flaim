import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";

/**
 * Site layout with minimal product navigation and contextual page discovery.
 * Used for all public site pages outside the internal /dev surface.
 */
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-muted w-full flex-col items-stretch text-foreground">
      <SiteHeader />
      <main className="flex-1 bg-background overflow-auto w-full">
        <div className="flex w-full flex-col min-h-full">
          <div className="flex-1">{children}</div>
          <footer className="w-full border-t bg-background px-4 py-8 sm:px-6">
            <div className="mx-auto max-w-5xl text-center">
              <nav
                aria-label="Footer navigation"
                className="flex flex-wrap items-center justify-center gap-x-5 gap-y-3 text-sm text-muted-foreground"
              >
                <Link href="/guide" className="hover:text-foreground">
                  Docs
                </Link>
                <Link href="/support" className="hover:text-foreground">
                  Support
                </Link>
                <Link href="/privacy" className="hover:text-foreground">
                  Privacy
                </Link>
                <Link href="/terms" className="hover:text-foreground">
                  Terms
                </Link>
                <Link href="/inspirations" className="hover:text-foreground">
                  Inspirations
                </Link>
              </nav>

              <p className="mx-auto mt-6 max-w-3xl border-t pt-5 text-xs leading-5 text-muted-foreground">
                Flaim is an independent project and is not affiliated with ESPN,
                Yahoo, Sleeper, OpenAI, Anthropic, or Perplexity.
              </p>
            </div>
            <p className="mx-auto mt-2 max-w-3xl text-center text-xs leading-5 text-muted-foreground">
              Fantasy data provided by{" "}
              <a
                href="https://sports.yahoo.com/fantasy/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Yahoo Fantasy
              </a>
              , ESPN, and Sleeper.
            </p>
          </footer>
        </div>
      </main>
    </div>
  );
}
