"use client";

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Alert, AlertDescription } from '../ui/alert';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { Loader2, Trophy, Users, Calendar, AlertCircle, CheckCircle } from 'lucide-react';
import useOnboardingStore from '@/stores/useOnboardingStore';

interface AutoPullResponse {
  success?: boolean;
  error?: string;
  leagueInfo?: any;
}

export default function AutoPullSummary() {
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  
  const { 
    currentLeagueEntry,
    autoPullData,
    setAutoPullData,
    updateEspnLeague,
    setStep,
    setError,
    error,
    // isAutoPulling, // Currently not used in this component
    setIsAutoPulling
  } = useOnboardingStore();

  // Auto-pull league data on component mount
  useEffect(() => {
    if (currentLeagueEntry && !autoPullData) {
      fetchLeagueData();
    } else if (autoPullData) {
      setIsLoading(false);
      // Pre-select team if we can identify it from credentials
      autoSelectUserTeam();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeagueEntry, autoPullData]);

  // Auto-select the user's team if already set in league data
  const autoSelectUserTeam = () => {
    if (!currentLeagueEntry || !autoPullData?.teams) return;

    // If the league already has a teamId set, pre-select it
    if (currentLeagueEntry.teamId) {
      const existingTeam = autoPullData.teams.find((team: any) => 
        team.teamId === currentLeagueEntry.teamId
      );
      
      if (existingTeam) {
        setSelectedTeamId(currentLeagueEntry.teamId);
        console.log(`🎯 Pre-selected existing team: ${existingTeam.teamName} (${currentLeagueEntry.teamId})`);
      }
    }
  };

  const fetchLeagueData = async () => {
    if (!currentLeagueEntry) return;

    setIsLoading(true);
    setIsAutoPulling(true);
    setError(null);

    try {
      const response = await fetch('/api/onboarding/espn/auto-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: currentLeagueEntry.leagueId,
          sport: currentLeagueEntry.sport
        })
      });

      const data = await response.json() as AutoPullResponse;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to retrieve league information');
      }

      if (!data.success || !data.leagueInfo) {
        throw new Error('No league information received');
      }

      setAutoPullData(data.leagueInfo);

    } catch (error) {
      console.error('Auto-pull error:', error);
      setError(error instanceof Error ? error.message : 'Failed to retrieve league information');
    } finally {
      setIsLoading(false);
      setIsAutoPulling(false);
    }
  };

  const handleSaveTeamSelection = async () => {
    if (!selectedTeamId || !currentLeagueEntry || !autoPullData) {
      setError('Please select a team');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      // Determine selected team object for name lookup
      const selectedTeam = autoPullData.teams?.find((t: any) => t.teamId?.toString() === selectedTeamId?.toString());

      // Save team selection to backend with additional metadata
      const response = await fetch(`/api/onboarding/espn/leagues/${currentLeagueEntry.leagueId}/team`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teamId: selectedTeamId,
          sport: currentLeagueEntry.sport,
          teamName: selectedTeam?.teamName,
          leagueName: autoPullData.leagueName,
          seasonYear: autoPullData.seasonYear
        })
      });

      const data = await response.json() as AutoPullResponse;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save team selection');
      }

      // Update the league in the store using selectedTeam from earlier
      if (currentLeagueEntry?.leagueId) {
        updateEspnLeague(currentLeagueEntry.leagueId, {
          teamId: selectedTeamId,
          teamName: selectedTeam?.teamName,
          leagueName: autoPullData.leagueName,
          seasonYear: autoPullData.seasonYear
        });
      }

      // Go back to confirmation/league list
      setStep('CONFIRMATION');

    } catch (error) {
      console.error('Team save error:', error);
      setError(error instanceof Error ? error.message : 'Failed to save team selection');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSkip = () => {
    // Go back to league list without setting team
    setStep('CONFIRMATION');
  };

  const getSportEmoji = (sport: string) => {
    const emojis: Record<string, string> = {
      'football': '🏈',
      'baseball': '⚾',
      'basketball': '🏀',
      'hockey': '🏒'
    };
    return emojis[sport] || '🏆';
  };

  if (!currentLeagueEntry) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No league selected for auto-pull. Please go back and select a league.
            </AlertDescription>
          </Alert>
          <div className="mt-4 text-center">
            <Button onClick={() => setStep('CONFIRMATION')}>
              Back to Leagues
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <Loader2 className="h-8 w-8 animate-spin mx-auto" />
            <h3 className="text-lg font-semibold">Retrieving League Information</h3>
            <p className="text-muted-foreground">
              Connecting to ESPN and fetching your league data...
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <div className="mt-4 text-center space-x-2">
            <Button onClick={fetchLeagueData} variant="outline">
              Try Again
            </Button>
            <Button onClick={handleSkip}>
              Skip for Now
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!autoPullData) {
    return (
      <Card>
        <CardContent className="pt-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No league data available. Please try fetching the data again.
            </AlertDescription>
          </Alert>
          <div className="mt-4 text-center">
            <Button onClick={fetchLeagueData}>
              Fetch League Data
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className="text-2xl">{getSportEmoji(currentLeagueEntry.sport || 'football')}</div>
          <h1 className="text-2xl font-bold text-foreground">League Information</h1>
        </div>
        <p className="text-muted-foreground">
          Review your league details and select your team
        </p>
      </div>

      {/* League Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5" />
            {autoPullData.leagueName}
          </CardTitle>
          <CardDescription>
            League ID: {currentLeagueEntry.leagueId}
          </CardDescription>
        </CardHeader>
        
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-primary">{autoPullData.seasonYear}</div>
              <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <Calendar className="h-4 w-4" />
                Season
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold text-primary">{autoPullData.teams?.length || 0}</div>
              <div className="text-sm text-muted-foreground flex items-center justify-center gap-1">
                <Users className="h-4 w-4" />
                Teams
              </div>
            </div>
            <div>
              <Badge className="text-base px-3 py-1">
                {(currentLeagueEntry.sport || 'football').charAt(0).toUpperCase() + (currentLeagueEntry.sport || 'football').slice(1)}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current Standings */}
      {autoPullData.standings && autoPullData.standings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Current Standings</CardTitle>
            <CardDescription>
              League standings and team performance
            </CardDescription>
          </CardHeader>
          
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Rank</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-center">W</TableHead>
                  <TableHead className="text-center">L</TableHead>
                  <TableHead className="text-center">T</TableHead>
                  <TableHead className="text-right">Win %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {autoPullData.standings.map((team: any) => (
                  <TableRow key={team.teamId}>
                    <TableCell className="font-medium">{team.rank}</TableCell>
                    <TableCell>{team.teamName}</TableCell>
                    <TableCell className="text-center">{team.wins}</TableCell>
                    <TableCell className="text-center">{team.losses}</TableCell>
                    <TableCell className="text-center">{team.ties}</TableCell>
                    <TableCell className="text-right">
                      {(team.winPercentage * 100).toFixed(1)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Team Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Your Team</CardTitle>
          <CardDescription>
            Choose which team in this league belongs to you
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {autoPullData.teams && autoPullData.teams.length > 0 ? (
            <RadioGroup 
              value={selectedTeamId} 
              onValueChange={setSelectedTeamId}
              className="space-y-2"
            >
              {autoPullData.teams.map((team: any) => {
                const standings = autoPullData.standings?.find((s: any) => s.teamId === team.teamId);
                return (
                  <div key={team.teamId} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-muted/50">
                    <RadioGroupItem value={team.teamId} id={team.teamId} />
                    <Label htmlFor={team.teamId} className="flex-1 cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{team.teamName}</div>
                          {team.ownerName && (
                            <div className="text-sm text-muted-foreground">
                              Owner: {team.ownerName}
                            </div>
                          )}
                        </div>
                        {standings && (
                          <div className="text-sm text-muted-foreground">
                            #{standings.rank} • {standings.wins}-{standings.losses}
                            {standings.ties > 0 && `-${standings.ties}`}
                          </div>
                        )}
                      </div>
                    </Label>
                  </div>
                );
              })}
            </RadioGroup>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No teams found in this league. There may be an issue with the league data.
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex gap-2 pt-4">
            <Button 
              onClick={handleSaveTeamSelection}
              disabled={!selectedTeamId || isSaving}
              className="flex-1"
            >
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Save & Continue
                </>
              )}
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleSkip}
              disabled={isSaving}
            >
              Skip for Now
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}