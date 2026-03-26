import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";

/**
 * Site layout - includes full header with navigation.
 * Used for all pages except /chat which has its own minimal header.
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
          <footer className="w-full py-6 px-4 text-center border-t bg-background">
            <div className="mx-auto grid max-w-md grid-cols-2 gap-x-6 gap-y-2 text-sm text-muted-foreground sm:flex sm:max-w-none sm:flex-wrap sm:items-center sm:justify-center">
              <a
                href="https://www.threads.com/@jdguggs10"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                Built by Gerry
              </a>
              <Link href="/privacy" className="underline hover:text-foreground">
                Privacy
              </Link>
              <Link href="/terms" className="underline hover:text-foreground">
                Terms
              </Link>
              <Link href="/inspirations" className="underline hover:text-foreground">
                Inspirations
              </Link>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
