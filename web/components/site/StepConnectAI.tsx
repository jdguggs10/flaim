'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Copy, Check } from 'lucide-react';

const fantasyMcpUrl =
  process.env.NEXT_PUBLIC_FANTASY_MCP_URL || 'https://api.flaim.app/mcp';

const mcpServers = [
  {
    name: 'Flaim Fantasy MCP',
    url: fantasyMcpUrl,
  },
];

export function StepConnectAI() {
  const { isLoaded, isSignedIn } = useAuth();
  const [copiedValue, setCopiedValue] = useState<string | null>(null);

  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(value);
      setTimeout(() => setCopiedValue(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const canShowServers = isLoaded && isSignedIn;

  return (
    <Card className="p-5 flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
          3
        </div>
        <h3 className="font-semibold text-lg">Connect your AI</h3>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Open your AI client&apos;s MCP settings, then copy the name and URL below to add Flaim as a remote MCP server.
      </p>

      {/* Platform badges */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <a
          href="https://claude.ai/settings/connectors"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center justify-center rounded-md border border-border px-3 py-2 hover:bg-muted transition-colors"
        >
          <div className="text-xs font-medium">Claude</div>
        </a>
        <div className="flex flex-col items-center justify-center rounded-md border border-border px-3 py-2">
          <div className="text-xs font-medium">ChatGPT</div>
          <div className="text-xs text-muted-foreground">Use MCP settings</div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-md border border-border px-3 py-2">
          <div className="text-xs font-medium">Gemini</div>
          <div className="text-xs text-muted-foreground">Use MCP settings</div>
        </div>
      </div>

      {!isLoaded && (
        <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
          Loading account status...
        </div>
      )}

      {isLoaded && !isSignedIn && (
        <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
          Sign in to unlock the MCP server name and URL.
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
    </Card>
  );
}
