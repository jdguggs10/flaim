import { redirect } from "next/navigation";
import { requireChatAccess } from "@/lib/chat/auth";
import { NextResponse } from "next/server";
import type { Metadata } from "next";
import ChatInterface from "../chat/_components/ChatInterface";

export const metadata: Metadata = {
  title: "Dev Chat Lab | Flaim",
  description: "Internal Flaim chat lab for manual MCP debugging and trace inspection.",
};

export default async function DevPage() {
  const result = await requireChatAccess();

  if (result instanceof NextResponse) {
    const status = result.status;
    redirect(status === 401 ? "/sign-in" : "/");
  }

  return <ChatInterface />;
}
