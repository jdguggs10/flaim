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
    <div className="flex h-screen bg-muted w-full flex-col text-foreground">
      <SiteHeader />
      <main className="flex-1 bg-background overflow-auto">
        <div className="flex flex-col min-h-full">
          <div className="flex-1">{children}</div>
          <footer className="py-6 px-4 text-center border-t bg-background">
            <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
              <span>Built by Gerry for fun</span>
              <span aria-hidden="true">·</span>
              <a href="/privacy" className="underline hover:text-foreground">
                Privacy
              </a>
              <span aria-hidden="true">·</span>
              <a href="/inspirations" className="underline hover:text-foreground">
                Inspirations
              </a>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
