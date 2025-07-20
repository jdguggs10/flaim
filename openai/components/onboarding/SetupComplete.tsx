"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { CheckCircle, MessageSquare, Zap, Settings } from 'lucide-react';
import useOnboardingStore from '@/stores/useOnboardingStore';
import { getSportConfig } from '@/lib/onboarding/league-mapper';

export default function SetupComplete() {
  const { 
    selectedPlatform, 
    selectedLeague,
    espnLeagues,
    resetOnboarding,
    completeOnboarding
  } = useOnboardingStore();

  const handleStartChatting = () => {
    // Mark onboarding as complete - this will trigger the Assistant component to show the chat
    completeOnboarding();
    // The Assistant component will detect completion and show the chat interface
  };

  const handleReconfigure = () => {
    resetOnboarding();
  };

  // Fallback: if selectedLeague is not set (new multi-league flow), use the first
  // configured ESPN league so we can still render confirmation details.
  const displayLeague = selectedLeague || (espnLeagues.length > 0 ? {
    leagueId: espnLeagues[0].leagueId,
    teamId: espnLeagues[0].teamId || '',
    sport: espnLeagues[0].sport,
    platform: selectedPlatform as any,
    name: espnLeagues[0].leagueName || `League ${espnLeagues[0].leagueId}`
  } : null);

  // If platform is still unknown, render a minimal completion view
  if (!selectedPlatform) {
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-bold text-foreground">Setup Complete!</h1>
        <p className="text-muted-foreground">You can start chatting with your AI assistant.</p>
        <Button onClick={completeOnboarding}>Start Chatting</Button>
      </div>
    );
  }

  if (!displayLeague) {
    // No league to show – still allow the user to proceed
    return (
      <div className="space-y-6 text-center">
        <h1 className="text-2xl font-bold text-foreground">Setup Complete!</h1>
        <p className="text-muted-foreground">Your assistant is ready.</p>
        <Button onClick={completeOnboarding}>Start Chatting</Button>
      </div>
    );
  }

  // Ensure the sport is one of the valid Sport types
  const sport = displayLeague.sport as 'baseball' | 'football' | 'basketball' | 'hockey';
  const sportConfig = getSportConfig(sport);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-4">
        <div className="flex justify-center">
          <div className="w-16 h-16 bg-primary/20 rounded-full flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-primary" />
          </div>
        </div>
        
        <div>
          <h1 className="text-2xl font-bold text-foreground">Setup Complete!</h1>
          <p className="text-muted-foreground">
            Your FLAIM assistant is ready to help with your fantasy league
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="text-xl">{sportConfig.emoji}</span>
            Your Configuration
          </CardTitle>
          <CardDescription>
            Here&apos;s what we&apos;ve set up for you
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <div className="font-medium text-foreground">Platform</div>
                <div className="text-sm text-muted-foreground">{selectedPlatform} Fantasy</div>
              </div>
              <Badge variant="outline">{selectedPlatform}</Badge>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <div className="font-medium text-foreground">League</div>
                <div className="text-sm text-muted-foreground">{displayLeague.name}</div>
              </div>
              <Badge className={sportConfig.color}>
                {sportConfig.name}
              </Badge>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
              <div>
                <div className="font-medium text-foreground">AI Tools</div>
                <div className="text-sm text-muted-foreground">
                  {sportConfig.mcpTools.length} tools configured
                </div>
              </div>
              <Badge variant="default">
                <Zap className="w-3 h-3 mr-1" />
                Active
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>What you can do now</CardTitle>
          <CardDescription>
            Your AI assistant is ready to help with these tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-primary mt-0.5" />
              <div>
                <div className="font-medium text-foreground">Get league insights</div>
                <div className="text-muted-foreground">Ask about standings, matchups, and team performance</div>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-primary mt-0.5" />
              <div>
                <div className="font-medium text-foreground">Analyze your team</div>
                <div className="text-muted-foreground">Get recommendations for lineups and roster moves</div>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <CheckCircle className="w-4 h-4 text-primary mt-0.5" />
              <div>
                <div className="font-medium text-foreground">Strategic advice</div>
                <div className="text-muted-foreground">Get help with trades, waivers, and game planning</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={handleStartChatting} className="flex-1">
          <MessageSquare className="w-4 h-4 mr-2" />
          Start Chatting
        </Button>
        
        <Button 
          variant="outline" 
          onClick={handleReconfigure}
          className="flex items-center gap-2"
        >
          <Settings className="w-4 h-4" />
          Reconfigure
        </Button>
      </div>

      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          You can always change these settings later in the tools panel
        </p>
      </div>
    </div>
  );
}