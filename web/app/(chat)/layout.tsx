/**
 * Chat layout - no site header, full-height container.
 * The ChatInterface component handles its own header and sidebar.
 */
export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-background w-full flex-col text-foreground">
      {children}
    </div>
  );
}
