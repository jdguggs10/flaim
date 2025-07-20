"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Label } from '../ui/label';
import { CheckCircle, Users, Calendar, Trophy } from 'lucide-react';
import useOnboardingStore, { League, SelectedLeague } from '@/stores/useOnboardingStore';

export default function LeagueSelector() {
  const {
    discoveredLeagues,
    selectedLeague,
    setSelectedLeague,
    selectedPlatform,
    completeOnboarding
  } = useOnboardingStore();

  const [selectedLeagueId, setSelectedLeagueId] = useState<string>(
    selectedLeague?.leagueId || ''
  );
  const [selectedTeamId, setSelectedTeamId] = useState<string>(
    selectedLeague?.teamId || ''
  );

  const handleLeagueSelect = (leagueId: string) => {
    setSelectedLeagueId(leagueId);
    setSelectedTeamId(''); // Reset team selection when league changes
  };

  const handleTeamSelect = (teamId: string) => {
    setSelectedTeamId(teamId);
  };

  const handleConfirmSelection = () => {
    const league = discoveredLeagues.find(l => l.leagueId === selectedLeagueId);
    const team = league?.teams.find(t => t.teamId === selectedTeamId);

    if (league && team && selectedPlatform) {
      const selection: SelectedLeague = {
        leagueId: league.leagueId,
        teamId: team.teamId,
        sport: league.sport,
        platform: selectedPlatform,
        name: league.name
      };

      setSelectedLeague(selection);
      completeOnboarding();
    }
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

  const getSportColor = (sport: string) => {
    switch (sport) {
      case 'baseball': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'football': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      case 'basketball': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
      case 'hockey': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400';
      default: return 'bg-secondary text-secondary-foreground';
    }
  };

  // Group leagues by sport
  const leaguesBySport = discoveredLeagues.reduce((acc, league) => {
    if (!acc[league.sport]) {
      acc[league.sport] = [];
    }
    acc[league.sport].push(league);
    return acc;
  }, {} as Record<string, League[]>);

  const selectedLeagueData = discoveredLeagues.find(l => l.leagueId === selectedLeagueId);
  const canConfirm = selectedLeagueId && selectedTeamId;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Choose Your Primary League</h1>
        <p className="text-muted-foreground">
          Select the fantasy league you&apos;d like to focus on with FLAIM
        </p>
      </div>

      <div className="space-y-6">
        {/* League Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5" />
              Select League
            </CardTitle>
            <CardDescription>
              Choose from your {discoveredLeagues.length} discovered league{discoveredLeagues.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={selectedLeagueId}
              onValueChange={handleLeagueSelect}
              className="space-y-3"
            >
              {Object.entries(leaguesBySport).map(([sport, leagues]) => (
                <div key={sport} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{getSportEmoji(sport)}</span>
                    <h3 className="font-medium text-foreground capitalize">{sport}</h3>
                    <Badge variant="outline" className="text-xs">
                      {leagues.length} league{leagues.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  
                  {leagues.map((league) => (
                    <div key={league.leagueId} className="ml-6">
                      <div className="flex items-center space-x-3">
                        <RadioGroupItem
                          value={league.leagueId}
                          id={league.leagueId}
                        />
                        <Label
                          htmlFor={league.leagueId}
                          className="flex-1 cursor-pointer"
                        >
                          <Card className={`transition-all ${
                            selectedLeagueId === league.leagueId 
                              ? 'ring-2 ring-primary border-primary' 
                              : 'hover:border-primary/50'
                          }`}>
                            <CardContent className="pt-4">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <h4 className="font-medium text-foreground">{league.name}</h4>
                                  <Badge className={getSportColor(league.sport)}>
                                    {league.sport}
                                  </Badge>
                                </div>
                                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Users className="h-4 w-4" />
                                    {league.teams.length} teams
                                  </span>
                                  <span className="flex items-center gap-1">
                                    <Calendar className="h-4 w-4" />
                                    {league.seasonYear}
                                  </span>
                                  {league.isActive && (
                                    <Badge variant="outline" className="text-xs">
                                      Active
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        </Label>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Team Selection */}
        {selectedLeagueData && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Select Your Team
              </CardTitle>
              <CardDescription>
                Choose your team from &quot;{selectedLeagueData.name}&quot;
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={selectedTeamId}
                onValueChange={handleTeamSelect}
                className="space-y-2"
              >
                {selectedLeagueData.teams.map((team) => (
                  <div key={team.teamId} className="flex items-center space-x-3">
                    <RadioGroupItem
                      value={team.teamId}
                      id={team.teamId}
                    />
                    <Label
                      htmlFor={team.teamId}
                      className="flex-1 cursor-pointer"
                    >
                      <div className={`p-3 rounded-lg border transition-all ${
                        selectedTeamId === team.teamId
                          ? 'ring-2 ring-primary border-primary bg-primary/5'
                          : 'hover:border-primary/50'
                      }`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-foreground">{team.name}</span>
                          {team.isUserTeam && (
                            <Badge variant="default" className="text-xs">
                              Your Team
                            </Badge>
                          )}
                        </div>
                      </div>
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>
        )}

        {/* Confirmation */}
        {canConfirm && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-5 w-5 text-primary" />
                    <h3 className="font-medium text-foreground">Selection Complete</h3>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {selectedLeagueData?.name} • {selectedLeagueData?.teams.find(t => t.teamId === selectedTeamId)?.name}
                  </p>
                </div>
                <Button onClick={handleConfirmSelection} className="ml-4">
                  Complete Setup
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}