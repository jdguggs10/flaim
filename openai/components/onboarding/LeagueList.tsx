"use client";

import React, { useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Badge, Alert, AlertDescription, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui';
import { Plus, Trash2, Settings, CheckCircle, Circle } from 'lucide-react';
import useOnboardingStore from '@/stores/useOnboardingStore';
import SkipStepBanner from './SkipStepBanner';

export default function LeagueList() {
  const { 
    espnLeagues,
    removeEspnLeague,
    setStep,
    canAddMoreLeagues,
    setCurrentLeagueEntry,
    setSelectedTeamId,
    setAutoPullData,
    setEspnLeagues
  } = useOnboardingStore();

  // Hydration safety-net: Load leagues from backend if store is empty after page refresh
  useEffect(() => {
    if (espnLeagues.length === 0) {
      fetch('/api/onboarding/espn/leagues')
        .then(r => r.ok ? r.json() : null)
        .then((json: unknown) => {
          if (json && typeof json === 'object' && 'leagues' in json) {
            const typedJson = json as { leagues?: any[] };
            if (typedJson.leagues && Array.isArray(typedJson.leagues)) {
              setEspnLeagues(typedJson.leagues);
            }
          }
        })
        .catch(() => {/* ignore errors - user can re-add leagues if needed */});
    }
  }, [espnLeagues.length, setEspnLeagues]);

  const getSportEmoji = (sport: string) => {
    const emojis: Record<string, string> = {
      'football': '🏈',
      'baseball': '⚾',
      'basketball': '🏀',
      'hockey': '🏒'
    };
    return emojis[sport] || '🏆';
  };

  const getSportColor = (sport: string) => {
    const colors: Record<string, string> = {
      'football': 'bg-orange-100 text-orange-800 border-orange-200',
      'baseball': 'bg-green-100 text-green-800 border-green-200',
      'basketball': 'bg-blue-100 text-blue-800 border-blue-200',
      'hockey': 'bg-purple-100 text-purple-800 border-purple-200'
    };
    return colors[sport] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const handleRemoveLeague = async (leagueId: string, sport: string) => {
    try {
      // Remove from store
      removeEspnLeague(leagueId);

      // Remove from backend
      const response = await fetch(`/api/onboarding/espn/leagues?leagueId=${leagueId}&sport=${sport}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const data = await response.json() as { error?: string };
        console.error('Failed to remove league from backend:', data.error);
        // Note: We could re-add to store here if needed
      }
    } catch (error) {
      console.error('Error removing league:', error);
    }
  };

  const handleAddAnother = () => {
    // Clear any previous league entry state
    setCurrentLeagueEntry(null);
    setSelectedTeamId(null);
    setAutoPullData(null);
    
    // Go back to league entry
    setStep('LEAGUE_ENTRY');
  };

  const handleAutoPull = (leagueId: string, sport: string) => {
    const league = espnLeagues.find(l => l.leagueId === leagueId && l.sport === sport);
    if (league) {
      // Set the current league for auto-pull
      setCurrentLeagueEntry(league);
      setStep('AUTO_PULL');
    }
  };

  const handleContinue = () => {
    // Check if at least one league has a team selected
    const hasCompletedLeague = espnLeagues.some(league => !!league.teamId);
    
    if (hasCompletedLeague) {
      setStep('COMPLETED');
    } else {
      // Suggest auto-pull for the first league
      if (espnLeagues.length > 0) {
        handleAutoPull(espnLeagues[0].leagueId, espnLeagues[0].sport);
      }
    }
  };

  const allTeamsSelected = espnLeagues.length > 0 && espnLeagues.every(l => !!l.teamId);

  if (espnLeagues.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <div className="text-6xl">📋</div>
            <h3 className="text-lg font-semibold">No Leagues Added Yet</h3>
            <p className="text-muted-foreground">
              Add your first ESPN league to get started with your fantasy assistant.
            </p>
            <Button onClick={handleAddAnother} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Your First League
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {allTeamsSelected && (
        <SkipStepBanner
          text="All teams configured."
          onSkip={() => setStep('COMPLETED')}
        />
      )}
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Your ESPN Leagues</h1>
        <p className="text-muted-foreground">
          Manage your leagues and complete setup
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Added Leagues ({espnLeagues.length}/10)</span>
            <TooltipProvider delayDuration={200}>
              {canAddMoreLeagues() ? (
                <Button 
                  onClick={handleAddAnother}
                  size="sm"
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Add Another
                </Button>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button 
                        size="sm"
                        variant="outline"
                        disabled
                        className="flex items-center gap-2"
                      >
                        <Plus className="h-4 w-4" />
                        Add Another
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Maximum of 10 leagues reached. Remove a league to add another.</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>
          </CardTitle>
          <CardDescription>
            Review your leagues and set up team identification
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {espnLeagues.map((league) => (
            <div 
              key={`${league.leagueId}-${league.sport}`}
              className="flex items-center justify-between p-4 border rounded-lg"
            >
              <div className="flex items-center gap-3 flex-1">
                <div className="text-2xl">{getSportEmoji(league.sport)}</div>
                
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold">
                      {league.leagueName || `League ${league.leagueId}`}
                    </h3>
                    <Badge className={getSportColor(league.sport)}>
                      {league.sport.charAt(0).toUpperCase() + league.sport.slice(1)}
                    </Badge>
                  </div>
                  
                  <div className="text-sm text-muted-foreground">
                    League ID: {league.leagueId}
                    {league.teamId && (
                      <span className="ml-2 text-green-600">
                        • Team selected
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {league.teamId ? (
                    <CheckCircle className="h-5 w-5 text-green-500" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-400" />
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 ml-4">
                {!league.teamId && (
                  <Button
                    size="sm"
                    onClick={() => handleAutoPull(league.leagueId, league.sport)}
                    className="flex items-center gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    Set Up Team
                  </Button>
                )}
                
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemoveLeague(league.leagueId, league.sport)}
                  className="text-red-600 hover:text-red-800"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {!canAddMoreLeagues() && (
        <Alert>
          <AlertDescription>
            You&apos;ve reached the maximum of 10 leagues. Remove a league to add a new one.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <h3 className="text-lg font-semibold">Ready to Continue?</h3>
            <p className="text-muted-foreground">
              {espnLeagues.some(l => !!l.teamId) 
                ? 'You can continue with your current setup or add more leagues.'
                : 'Set up team identification for at least one league to continue.'
              }
            </p>
            
            <div className="flex gap-2 justify-center">
              <TooltipProvider delayDuration={200}>
                {canAddMoreLeagues() ? (
                  <Button 
                    variant="outline" 
                    onClick={handleAddAnother}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Another League
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button 
                          variant="outline" 
                          disabled
                          className="flex items-center gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          Add Another League
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Maximum of 10 leagues reached. Remove a league to add another.</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </TooltipProvider>
              
              <Button 
                onClick={handleContinue}
                disabled={espnLeagues.length === 0}
              >
                {espnLeagues.some(l => !!l.teamId) ? 'Complete Setup' : 'Set Up Teams'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}