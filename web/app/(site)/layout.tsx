export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1">{children}</div>
      <footer className="py-6 px-4 text-center border-t bg-background">
        <p className="text-sm text-muted-foreground">
          Built by Gerry
        </p>
      </footer>
    </div>
  );
}
