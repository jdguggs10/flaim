import { currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export async function requireChatAccess(): Promise<
  { userId: string } | NextResponse
> {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 }
    );
  }
  if (user.publicMetadata?.chatAccess !== true) {
    return NextResponse.json(
      { error: "Chat access not enabled" },
      { status: 403 }
    );
  }
  return { userId: user.id };
}
