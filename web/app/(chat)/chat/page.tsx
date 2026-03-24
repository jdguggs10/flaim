import { PublicChatExperience } from "@/components/chat/public-chat-experience";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Chat Demo | Flaim",
  description:
    "Run Flaim against a real demo account and watch the live MCP tool activity.",
};

export default function ChatPage() {
  return <PublicChatExperience />;
}
