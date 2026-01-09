export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1">{children}</div>
      <footer className="py-6 px-4 text-center border-t bg-background">
        <div className="text-sm text-muted-foreground flex items-center justify-center gap-2">
          <span>Built by Gerry for fun</span>
          <span aria-hidden="true">·</span>
          <a href="/privacy#your-data" className="underline hover:text-foreground">
            Your Data
          </a>
          <span aria-hidden="true">·</span>
          <a href="/inspirations" className="underline hover:text-foreground">
            Inspirations
          </a>
        </div>
      </footer>
    </div>
  );
}
