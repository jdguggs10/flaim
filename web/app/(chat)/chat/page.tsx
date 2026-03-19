import { redirect } from "next/navigation";
import { requireChatAccess } from "@/lib/chat/auth";
import { NextResponse } from "next/server";
import ChatInterface from "./_components/ChatInterface";

export default async function ChatPage() {
  const result = await requireChatAccess();

  if (result instanceof NextResponse) {
    const status = result.status;
    redirect(status === 401 ? "/sign-in" : "/");
  }

  return <ChatInterface />;
}
