"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Copy, Check, ExternalLink } from "lucide-react";
import Link from "next/link";

const fantasyMcpUrl =
  process.env.NEXT_PUBLIC_FANTASY_MCP_URL || "https://api.flaim.app/mcp";

const mcpServers = [
  {
    name: "Flaim Fantasy",
    url: fantasyMcpUrl,
  },
];

interface StepConnectAIProps {
  showStepNumber?: boolean;
  renderCard?: boolean;
  showHeader?: boolean;
}

export function StepConnectAI({
  showStepNumber = true,
  renderCard = true,
  showHeader = true,
}: StepConnectAIProps) {
  const { isLoaded, isSignedIn } = useAuth();
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const canShowServers = isLoaded && isSignedIn;

  const content = (
    <div className="flex flex-col">
      {showHeader ? (
        <>
          <div className="mb-4 flex items-center gap-3">
            {showStepNumber ? (
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                3
              </div>
            ) : null}
            <h3 className="font-semibold text-lg">Connect your AI</h3>
          </div>

          <p className="mb-4 text-sm text-muted-foreground">
            Copy the name and URL below, then add Flaim in your AI assistant.
          </p>
        </>
      ) : null}

      <p className="mb-3 text-xs text-muted-foreground">
        Pick your assistant for step-by-step instructions.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Link
            href="/guide/ai#claude"
            className="text-xs font-medium text-primary hover:underline"
          >
            Claude
          </Link>
          <a
            href="https://claude.ai/settings/connectors"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Open Claude connectors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Link
            href="/guide/ai#chatgpt"
            className="text-xs font-medium text-primary hover:underline"
          >
            ChatGPT
          </Link>
          <a
            href="https://chatgpt.com/settings#settings/Connectors"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Open ChatGPT settings"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <Link
            href="/guide/ai#perplexity"
            className="text-xs font-medium text-primary hover:underline"
          >
            Perplexity
          </Link>
          <a
            href="https://www.perplexity.ai/account/connectors"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Open Perplexity connectors"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        Claude, ChatGPT, and Perplexity are live today.
      </p>

      {!isLoaded && (
        <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
          Loading account status...
        </div>
      )}

      {isLoaded && !isSignedIn && (
        <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
          Sign in to unlock the MCP server name and URL for your account.
        </div>
      )}

      {canShowServers && (
        <div className="space-y-3">
          {mcpServers.map(({ name, url }) => (
            <div key={name} className="p-3 bg-muted rounded-lg space-y-2">
              {/* Name row */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Name</span>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-background px-2 py-1 rounded border font-mono">
                    {name}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={() => handleCopy(name)}
                    title="Copy name"
                  >
                    {copiedValue === name ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
              {/* URL row */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">URL</span>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="text-xs bg-background px-2 py-1 rounded border font-mono truncate">
                    {url}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 flex-shrink-0"
                    onClick={() => handleCopy(url)}
                    title="Copy URL"
                  >
                    {copiedValue === url ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return renderCard ? <Card className="p-5">{content}</Card> : content;
}
