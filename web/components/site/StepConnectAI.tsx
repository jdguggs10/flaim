'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Copy, Check, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const fantasyMcpUrl =
  process.env.NEXT_PUBLIC_FANTASY_MCP_URL || 'https://api.flaim.app/fantasy/mcp';

const mcpConnectors = [
  {
    name: 'Flaim Fantasy MCP',
    url: fantasyMcpUrl,
    description: 'All sports in one connector',
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

  const canShowConnectors = isLoaded && isSignedIn;

  return (
    <Card className="p-5 flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
          3
        </div>
        <h3 className="font-semibold text-lg">Connect your AI</h3>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Click on your preferred AI, then copy the name and url to add Flaim as a custom connector.
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
        <div className="flex flex-col items-center justify-center rounded-md bg-muted px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">ChatGPT</div>
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <span>Dev mode only</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center"
                  aria-label="Why is ChatGPT dev mode only?"
                >
                  <Info className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-xs">
                OpenAI has not released their connector functionality publicly yet
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-md bg-muted px-3 py-2">
          <div className="text-xs font-medium text-muted-foreground">Gemini</div>
          <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <span>Coming soon?</span>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center"
                  aria-label="What is the status of Gemini connectors?"
                >
                  <Info className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-xs">
                Google is reportedly working on MCP connectors but nothing has been released yet
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      {!isLoaded && (
        <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
          Loading account status...
        </div>
      )}

      {isLoaded && !isSignedIn && (
        <div className="rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
          Sign in to unlock the connector URLs.
        </div>
      )}

      {canShowConnectors && (
        <div className="space-y-3">
          {mcpConnectors.map(({ name, url }) => (
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
