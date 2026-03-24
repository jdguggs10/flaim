import { redirect } from "next/navigation";
import { requireChatAccess } from "@/lib/chat/auth";
import { NextResponse } from "next/server";
import DevChatInterface from "./_components/DevChatInterface";

export default async function DevPage() {
  const result = await requireChatAccess();

  if (result instanceof NextResponse) {
    const status = result.status;
    redirect(status === 401 ? "/sign-in" : "/");
  }

  return <DevChatInterface />;
}
