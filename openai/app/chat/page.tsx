import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ChatInterface from "./_components/ChatInterface";

export default async function ChatPage() {
  const user = await currentUser();

  if (!user) {
    redirect("/sign-in");
  }

  if (user.publicMetadata?.chatAccess !== true) {
    redirect("/");
  }

  return <ChatInterface />;
}
