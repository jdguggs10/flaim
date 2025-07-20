"use client";

import React, { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { Loader2, Search, AlertCircle } from 'lucide-react';
import useOnboardingStore from '@/stores/useOnboardingStore';

interface DiscoveryResponse {
  error?: string;
  success?: boolean;
  leagues?: any[];
}

export default function LeagueDiscovery() {
  const { 
    selectedPlatform,
    isDiscoveringLeagues,
    setIsDiscoveringLeagues,
    setDiscoveredLeagues,
    setError,
    error,
    discoveredLeagues
  } = useOnboardingStore();

  useEffect(() => {
    const discoverLeagues = async () => {
      if (!selectedPlatform) return;
      
      setIsDiscoveringLeagues(true);
      setError(null);

      try {
        const response = await fetch('/api/onboarding/leagues');
        const data = await response.json() as DiscoveryResponse;

        if (!response.ok) {
          throw new Error(data.error || 'Failed to discover leagues');
        }

        // Transform the leagues data to match our interface
        const leagues = data.leagues?.map((league: any) => ({
          leagueId: league.leagueId,
          name: league.name,
          sport: determineSportFromGameId(league.gameId),
          gameId: league.gameId,
          teams: league.teams || [],
          isActive: league.isActive !== false,
          seasonYear: league.seasonYear || new Date().getFullYear(),
          platform: selectedPlatform
        })) || [];

        setDiscoveredLeagues(leagues);

      } catch (error) {
        console.error('League discovery error:', error);
        setError(error instanceof Error ? error.message : 'Failed to discover leagues');
      } finally {
        setIsDiscoveringLeagues(false);
      }
    };

    discoverLeagues();
  }, [selectedPlatform, setIsDiscoveringLeagues, setDiscoveredLeagues, setError]);

  // Helper function to determine sport from ESPN gameId
  const determineSportFromGameId = (gameId: string): 'baseball' | 'football' | 'basketball' | 'hockey' => {
    if (gameId.includes('flb')) return 'baseball';
    if (gameId.includes('ffl')) return 'football';
    if (gameId.includes('fba')) return 'basketball';
    if (gameId.includes('fhl')) return 'hockey';
    
    // Default to football if unknown
    return 'football';
  };

  const getSportEmoji = (sport: string) => {
    switch (sport) {
      case 'baseball': return '⚾';
      case 'football': return '🏈';
      case 'basketball': return '🏀';
      case 'hockey': return '🏒';
      default: return '🏆';
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">League Discovery Failed</h1>
          <p className="text-muted-foreground">
            We couldn&apos;t find your leagues
          </p>
        </div>

        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle>What to try next</CardTitle>
            <CardDescription>Here are some things you can check:</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <h4 className="font-medium">Check your credentials</h4>
              <p className="text-muted-foreground">Make sure your SWID and ESPN_S2 are correct</p>
            </div>
            <div>
              <h4 className="font-medium">Verify league membership</h4>
              <p className="text-muted-foreground">Ensure you&apos;re a member of at least one fantasy league</p>
            </div>
            <div>
              <h4 className="font-medium">Try refreshing</h4>
              <p className="text-muted-foreground">Sometimes ESPN needs a moment to sync</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isDiscoveringLeagues && discoveredLeagues.length > 0) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Leagues Found!</h1>
          <p className="text-muted-foreground">
            We discovered {discoveredLeagues.length} league{discoveredLeagues.length !== 1 ? 's' : ''} for your account
          </p>
        </div>

        <div className="grid gap-3">
          {discoveredLeagues.slice(0, 3).map((league) => (
            <Card key={league.leagueId} className="border-l-4 border-l-primary/50">
              <CardContent className="pt-4">
                <div className="flex items-center gap-3">
                  <div className="text-xl">{getSportEmoji(league.sport)}</div>
                  <div>
                    <h3 className="font-medium text-foreground">{league.name}</h3>
                    <p className="text-sm text-muted-foreground capitalize">
                      {league.sport} • {league.seasonYear} • {league.teams.length} teams
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          
          {discoveredLeagues.length > 3 && (
            <Card className="border-dashed">
              <CardContent className="pt-4 text-center">
                <p className="text-sm text-muted-foreground">
                  +{discoveredLeagues.length - 3} more league{discoveredLeagues.length - 3 !== 1 ? 's' : ''}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <Search className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Discovering Your Leagues</h1>
        </div>
        <p className="text-muted-foreground">
          We&apos;re scanning your {selectedPlatform} account for fantasy leagues...
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            
            <div className="text-center space-y-2">
              <h3 className="font-medium text-foreground">Searching for leagues</h3>
              <p className="text-sm text-muted-foreground">
                This may take a few seconds...
              </p>
            </div>

            <div className="w-full space-y-2 text-center">
              <div className="text-xs text-muted-foreground">
                We&apos;re looking for:
              </div>
              <div className="flex justify-center gap-4 text-sm">
                <span className="flex items-center gap-1">
                  ⚾ Baseball
                </span>
                <span className="flex items-center gap-1">
                  🏈 Football
                </span>
                <span className="flex items-center gap-1">
                  🏀 Basketball
                </span>
                <span className="flex items-center gap-1">
                  🏒 Hockey
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}