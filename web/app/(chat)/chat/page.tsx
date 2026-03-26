import { PublicChatExperience } from "@/components/public-demo/public-chat-experience";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Chat Demo | Flaim",
  description:
    "Run Flaim against a real demo account and watch the live MCP tool activity.",
};

interface ChatPageProps {
  searchParams?: Promise<{
    preset?: string | string[];
  }>;
}

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const preset = resolvedSearchParams?.preset;
  const initialPresetId = Array.isArray(preset) ? preset[0] : preset;

  return <PublicChatExperience initialPresetId={initialPresetId ?? null} />;
}
