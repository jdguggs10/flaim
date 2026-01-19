'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Copy, Check, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const mcpConnectors = [
  {
    name: 'Flaim Football MCP',
    url: 'https://api.flaim.app/football/mcp',
  },
  {
    name: 'Flaim Baseball MCP',
    url: 'https://api.flaim.app/baseball/mcp',
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
    <div className="bg-background rounded-xl p-5 border flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
          3
        </div>
        <h3 className="font-semibold text-lg">Connect Your AI</h3>
      </div>

      <p className="text-sm text-muted-foreground mb-4">
        Click on one of the below, then copy the name and URL.
      </p>

      {/* Platform badges */}
      <div className="flex flex-wrap gap-2 mb-4">
        <a
          href="https://claude.ai/settings/connectors"
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-1.5 bg-primary/10 rounded-lg border border-primary/30 hover:bg-primary/20 transition-colors"
        >
          <div className="text-sm font-medium">Claude</div>
          <div className="text-xs text-primary">Ready today</div>
        </a>
        <div className="px-3 py-1.5 bg-muted rounded-lg border">
          <div className="text-sm font-medium">ChatGPT</div>
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
        <div className="px-3 py-1.5 bg-muted rounded-lg border">
          <div className="text-sm font-medium">Gemini</div>
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
                  <code className="text-sm bg-background px-2 py-1 rounded border font-mono">
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
                      <Check className="h-3.5 w-3.5 text-green-500" />
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
                      <Check className="h-3.5 w-3.5 text-green-500" />
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
}
