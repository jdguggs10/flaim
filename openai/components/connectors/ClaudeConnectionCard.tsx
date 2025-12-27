"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';

interface ClaudeConnectionCardProps {
  isConnected?: boolean;
  onDisconnect?: () => Promise<void>;
}

export default function ClaudeConnectionCard({
  isConnected = false,
  onDisconnect,
}: ClaudeConnectionCardProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const handleCopy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleDisconnect = async () => {
    if (!onDisconnect) return;

    setIsDisconnecting(true);
    setError(null);
    try {
      await onDisconnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white font-bold text-lg">
              C
            </div>
            <div>
              <CardTitle className="text-lg">Claude</CardTitle>
              <CardDescription>Anthropic AI Assistant</CardDescription>
            </div>
          </div>
          <Badge variant={isConnected ? 'default' : 'secondary'}>
            {isConnected ? (
              <>
                <CheckCircle className="h-3 w-3 mr-1" />
                Connected
              </>
            ) : (
              <>
                <XCircle className="h-3 w-3 mr-1" />
                Not Connected
              </>
            )}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* MCP URLs */}
        <div className="space-y-2">
          <div className="text-sm font-medium">MCP Server URLs</div>
          <div className="space-y-2">
            {mcpUrls.map(({ sport, url, emoji }) => (
              <div
                key={sport}
                className="flex items-center justify-between p-3 bg-muted rounded-lg"
              >
                <div className="flex items-center gap-2">
                  <span>{emoji}</span>
                  <span className="text-sm font-medium">{sport}</span>
                </div>
                <div className="flex items-center gap-2">
                  <code className="text-xs bg-background px-2 py-1 rounded border">
                    {url}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleCopy(url)}
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
        </div>

        {/* Error display */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1" asChild>
            <a
              href="https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-4 w-4 mr-2" />
              Setup Guide
            </a>
          </Button>
          {isConnected && onDisconnect && (
            <Button
              variant="destructive"
              className="flex-1"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                'Disconnect'
              )}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
