"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, ExternalLink, Clock } from 'lucide-react';

interface PlatformCardProps {
  name: string;
  icon: string;
  gradient: string;
  description: string;
  setupGuideUrl?: string;
  setupGuideLabel?: string;
  enabled: boolean;
  isConnected?: boolean;
}

export default function PlatformCard({
  name,
  icon,
  gradient,
  description,
  setupGuideUrl,
  setupGuideLabel = "Setup Guide",
  enabled,
  isConnected = false,
}: PlatformCardProps) {
  return (
    <Card className={!enabled ? 'opacity-60' : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-lg ${
                enabled ? gradient : 'bg-gray-400'
              }`}
            >
              {icon}
            </div>
            <div>
              <CardTitle className="text-lg">{name}</CardTitle>
              <CardDescription className="text-sm">{description}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {enabled ? (
          <>
            {/* Connection status */}
            {isConnected && (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span>Connected</span>
              </div>
            )}

            {/* Setup guide */}
            {setupGuideUrl && (
              <Button variant="outline" size="sm" className="w-full" asChild>
                <a
                  href={setupGuideUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  {setupGuideLabel}
                </a>
              </Button>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 py-2">
            <Badge variant="secondary" className="text-xs">
              <Clock className="h-3 w-3 mr-1" />
              Coming Soon
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
