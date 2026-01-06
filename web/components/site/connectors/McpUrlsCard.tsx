"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Copy, Check } from 'lucide-react';

const mcpUrls = [
  {
    sport: 'Football',
    url: 'https://api.flaim.app/football/mcp',
    emoji: '\u{1F3C8}',
  },
  {
    sport: 'Baseball',
    url: 'https://api.flaim.app/baseball/mcp',
    emoji: '\u26BE',
  },
];

export default function McpUrlsCard() {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">MCP Server URLs</CardTitle>
        <CardDescription>
          Use these URLs to connect any MCP-compatible AI assistant to your fantasy data.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-2">
          {mcpUrls.map(({ sport, url, emoji }) => (
            <div
              key={sport}
              className="flex items-start justify-between p-3 bg-muted rounded-lg gap-2"
            >
              <div className="flex items-center gap-2 flex-shrink-0">
                <span>{emoji}</span>
                <span className="text-sm font-medium">{sport}</span>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 flex-1 min-w-0">
                <code className="text-xs bg-background px-2 py-1 rounded border font-mono break-all w-full sm:w-auto">
                  {url}
                </code>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 flex-shrink-0"
                  onClick={() => handleCopy(url)}
                  title={`Copy ${sport} URL`}
                >
                  {copiedUrl === url ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
