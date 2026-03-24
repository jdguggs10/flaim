/**
 * Dedicated layout for the chat surfaces (`/chat` public, `/dev` internal).
 * These routes do not use the standard site header/footer shell.
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
