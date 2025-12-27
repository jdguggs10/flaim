"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, ExternalLink, Copy, Check } from 'lucide-react';

export default function ConnectInstructions() {
  const [isOpen, setIsOpen] = useState(true);
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  const handleCopy = async (text: string, step: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedStep(step);
      setTimeout(() => setCopiedStep(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const steps = [
    {
      title: 'Open Claude Settings',
      description: 'Go to Claude.ai or open Claude Desktop, then navigate to Settings.',
      action: (
        <Button variant="outline" size="sm" asChild>
          <a
            href="https://claude.ai/settings"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-3 w-3 mr-1" />
            Open Settings
          </a>
        </Button>
      ),
    },
    {
      title: 'Find Custom Connectors',
      description:
        'Look for "Integrations" or "MCP Servers" section in the settings menu.',
    },
    {
      title: 'Add New Connector',
      description: 'Click "Add Connector" or "Add MCP Server" and enter one of the FLAIM MCP URLs:',
      code: 'https://api.flaim.app/football/mcp',
      codeAlt: 'https://api.flaim.app/baseball/mcp',
    },
    {
      title: 'Authenticate',
      description:
        'Claude will redirect you to FLAIM to sign in and authorize access. Click "Allow" to grant permission.',
    },
    {
      title: 'Start Using',
      description:
        'Once connected, you can ask Claude about your fantasy leagues! Try: "What\'s my team\'s record?" or "Show me this week\'s matchup."',
    },
  ];

  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">How to Connect Claude</CardTitle>
            <CardDescription>
              Step-by-step guide to connect your FLAIM account to Claude
            </CardDescription>
          </div>
          {isOpen ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="pt-0">
            <div className="space-y-4">
              {steps.map((step, index) => (
                <div
                  key={index}
                  className="flex gap-4 pb-4 border-b last:border-0 last:pb-0"
                >
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="font-medium">{step.title}</div>
                    <p className="text-sm text-muted-foreground">
                      {step.description}
                    </p>
                    {step.code && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-lg border font-mono">
                            {step.code}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleCopy(step.code!, index)}
                          >
                            {copiedStep === index ? (
                              <Check className="h-4 w-4 text-green-500" />
                            ) : (
                              <Copy className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                        {step.codeAlt && (
                          <p className="text-xs text-muted-foreground">
                            Or for baseball: <code className="bg-muted px-1 rounded">{step.codeAlt}</code>
                          </p>
                        )}
                      </div>
                    )}
                    {step.action && <div className="pt-1">{step.action}</div>}
                  </div>
                </div>
              ))}
            </div>

            {/* Note about Claude Pro */}
            <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
              <p className="text-sm text-blue-800 dark:text-blue-300">
                <strong>Note:</strong> Claude direct access uses your Claude Pro subscription.
                You pay for AI usage through Anthropic, while FLAIM provides the fantasy data.
              </p>
            </div>
          </CardContent>
      )}
    </Card>
  );
}
