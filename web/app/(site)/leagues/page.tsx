"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Trophy,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Search,
  X,
  Star,
  History,
} from 'lucide-react';
import { getDefaultSeasonYear, type SeasonSport } from '@/lib/season-utils';
import { useEspnCredentials } from '@/lib/use-espn-credentials';

interface League {
  leagueId: string;
  sport: string;
  leagueName?: string;
  teamId?: string;
  teamName?: string;
  seasonYear?: number;
  isDefault?: boolean;
}

interface Team {
  id: string;
  name: string;
  owner?: string;
}

interface VerifiedLeague {
  leagueId: string;
  leagueName: string;
  sport: string;
  seasonYear: number;
  teams: Team[];
}

type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

interface LeagueGroup {
  key: string;
  leagueId: string;
  sport: string;
  leagueName?: string;
  seasons: League[];
}

const SPORT_OPTIONS: { value: Sport; label: string; emoji: string }[] = [
  { value: 'football', label: 'Football', emoji: '\u{1F3C8}' },
  { value: 'baseball', label: 'Baseball', emoji: '\u26BE' },
];

// Generate season options (current year down to 2000)
const MIN_YEAR = 2000;
const currentYear = new Date().getFullYear();
const SEASON_OPTIONS = Array.from(
  { length: currentYear - MIN_YEAR + 1 },
  (_, i) => currentYear - i
);

export default function LeaguesPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const espnCredentials = useEspnCredentials();
  const { hasCredentials, isCheckingCreds } = espnCredentials;

  // Leagues state
  const [leagues, setLeagues] = useState<League[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(true);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [leagueNotice, setLeagueNotice] = useState<string | null>(null);
  const [deletingLeagueKey, setDeletingLeagueKey] = useState<string | null>(null);
  const [settingDefaultKey, setSettingDefaultKey] = useState<string | null>(null);
  const [discoveringLeagueKey, setDiscoveringLeagueKey] = useState<string | null>(null);

  // Add league flow state
  const [newLeagueId, setNewLeagueId] = useState('');
  const [newLeagueSport, setNewLeagueSport] = useState<Sport>('football');
  const [newLeagueSeason, setNewLeagueSeason] = useState<number>(() => getDefaultSeasonYear('football'));
  const [seasonManuallySet, setSeasonManuallySet] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedLeague, setVerifiedLeague] = useState<VerifiedLeague | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isAddingLeague, setIsAddingLeague] = useState(false);

  // Expand/collapse state for league groups
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Group leagues by sport + leagueId
  const leagueGroups = useMemo((): LeagueGroup[] => {
    const grouped = new Map<string, LeagueGroup>();

    for (const league of leagues) {
      const key = `${league.sport}:${league.leagueId}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          key,
          leagueId: league.leagueId,
          sport: league.sport,
          leagueName: league.leagueName,
          seasons: [],
        });
      }
      grouped.get(key)!.seasons.push(league);
    }

    // Sort seasons desc within each group
    for (const group of grouped.values()) {
      group.seasons.sort((a, b) => (b.seasonYear || 0) - (a.seasonYear || 0));
      group.leagueName = group.seasons.find((season) => season.leagueName)?.leagueName || group.leagueName;
    }

    // Sort groups by most recent season (desc)
    return Array.from(grouped.values()).sort((a, b) => {
      const aYear = a.seasons[0]?.seasonYear || 0;
      const bYear = b.seasons[0]?.seasonYear || 0;
      return bYear - aYear;
    });
  }, [leagues]);

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Load leagues on mount
  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsLoadingLeagues(false);
      return;
    }

    const loadData = async () => {
      // Load leagues
      try {
        const leaguesRes = await fetch('/api/espn/leagues');
        if (leaguesRes.ok) {
          const data = await leaguesRes.json() as { leagues?: League[] };
          setLeagues(data.leagues || []);
        }
      } catch (err) {
        console.error('Failed to load leagues:', err);
      } finally {
        setIsLoadingLeagues(false);
      }
    };

    loadData();
  }, [isLoaded, isSignedIn]);

  // Verify league (call auto-pull to get league info)
  const handleVerifyLeague = async () => {
    if (!hasCredentials) {
      setLeagueError('Add your ESPN credentials on the Connectors page first');
      return;
    }

    if (!newLeagueId.trim()) {
      setLeagueError('League ID is required');
      return;
    }

    // Check for duplicates (including season year for multi-season support)
    const exists = leagues.some(
      (l) => l.leagueId === newLeagueId.trim() && l.sport === newLeagueSport && l.seasonYear === newLeagueSeason
    );
    if (exists) {
      setLeagueError('This league and season is already added');
      return;
    }

    setIsVerifying(true);
    setLeagueError(null);
    setLeagueNotice(null);
    setVerifiedLeague(null);
    setSelectedTeamId('');

    try {
      const res = await fetch('/api/espn/auto-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: newLeagueSport,
          leagueId: newLeagueId.trim(),
          seasonYear: newLeagueSeason,
        }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        leagueInfo?: {
          leagueId: string;
          leagueName: string;
          sport: string;
          seasonYear: number;
          teams: Array<{ id: string; name: string; owner?: string }>;
        };
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to verify league');
      }

      if (!data.leagueInfo) {
        throw new Error('No league info returned');
      }

      setVerifiedLeague({
        leagueId: newLeagueId.trim(),
        leagueName: data.leagueInfo.leagueName,
        sport: newLeagueSport,
        seasonYear: data.leagueInfo.seasonYear,
        teams: data.leagueInfo.teams.map((t: { teamId?: string; id?: string; teamName?: string; name?: string; ownerName?: string; owner?: string }) => ({
          id: String(t.teamId || t.id || ''),
          name: t.teamName || t.name || '',
          owner: t.ownerName || t.owner,
        })),
      });
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to verify league');
    } finally {
      setIsVerifying(false);
    }
  };

  // Add verified league with team selection
  const handleAddVerifiedLeague = async () => {
    if (!verifiedLeague) return;

    const selectedTeam = verifiedLeague.teams.find((t) => t.id === selectedTeamId);

    setIsAddingLeague(true);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const newLeague: League = {
        leagueId: verifiedLeague.leagueId,
        sport: verifiedLeague.sport,
        leagueName: verifiedLeague.leagueName,
        seasonYear: verifiedLeague.seasonYear,
        teamId: selectedTeamId || undefined,
        teamName: selectedTeam?.name,
      };

      const updatedLeagues = [...leagues, newLeague];

      const res = await fetch('/api/espn/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: updatedLeagues }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to add league');
      }

      setLeagues(updatedLeagues);
      setNewLeagueId('');
      setVerifiedLeague(null);
      setSelectedTeamId('');
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to add league');
    } finally {
      setIsAddingLeague(false);
    }
  };

  // Cancel verification
  const handleCancelVerification = () => {
    setVerifiedLeague(null);
    setSelectedTeamId('');
    setLeagueError(null);
  };

  // Delete league - removes ALL seasons of this league
  const handleDeleteLeague = async (leagueId: string, sport: string) => {
    const leagueKey = `${leagueId}-${sport}`;
    setDeletingLeagueKey(leagueKey);
    setLeagueNotice(null);

    try {
      // Delete all seasons of this league (no seasonYear = delete all)
      const deleteUrl = `/api/espn/leagues?leagueId=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(sport)}`;
      const res = await fetch(deleteUrl, { method: 'DELETE' });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to remove league');
      }

      // Remove all seasons of this league from local state
      setLeagues(leagues.filter((l) => !(l.leagueId === leagueId && l.sport === sport)));
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to remove league');
    } finally {
      setDeletingLeagueKey(null);
    }
  };

  // Set default league (requires seasonYear to target specific row)
  const handleSetDefault = async (leagueId: string, sport: string, seasonYear?: number) => {
    const leagueKey = `${leagueId}-${sport}-${seasonYear || 'all'}`;
    setSettingDefaultKey(leagueKey);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const res = await fetch('/api/espn/leagues/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, sport, seasonYear }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to set default league');
      }

      const data = await res.json() as { leagues?: League[] };
      if (data.leagues) {
        setLeagues(data.leagues);
      } else {
        // Fallback: update locally - only the specific season becomes default
        setLeagues((prev) => prev.map((l) => ({
          ...l,
          isDefault: l.leagueId === leagueId && l.sport === sport && l.seasonYear === seasonYear,
        })));
      }
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to set default league');
    } finally {
      setSettingDefaultKey(null);
    }
  };

  // Discover historical seasons for a league
  const handleDiscoverSeasons = async (leagueId: string, sport: string) => {
    // Only baseball and football are supported
    if (sport !== 'baseball' && sport !== 'football') {
      setLeagueError('Season discovery is only available for baseball and football leagues');
      return;
    }

    const leagueKey = `${leagueId}-${sport}`;
    setDiscoveringLeagueKey(leagueKey);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const response = await fetch('/api/espn/discover-seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, sport })
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        discovered?: Array<{ seasonYear: number; leagueName: string; teamCount: number }>;
        skipped?: number;
        rateLimited?: boolean;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Discovery failed');
      }

      // Show success message
      const count = data.discovered?.length || 0;
      const skipped = data.skipped || 0;
      const rateLimitedMsg = data.rateLimited ? ' (stopped early due to rate limiting)' : '';

      // Refresh leagues list to show newly discovered seasons
      const leaguesRes = await fetch('/api/espn/leagues');
      if (leaguesRes.ok) {
        const leaguesData = await leaguesRes.json() as { leagues?: League[] };
        setLeagues(leaguesData.leagues || []);
      }

      setLeagueNotice(`Discovered ${count} new season${count !== 1 ? 's' : ''}, ${skipped} already stored${rateLimitedMsg}`);
      setTimeout(() => setLeagueNotice(null), 5000);

    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to discover seasons');
    } finally {
      setDiscoveringLeagueKey(null);
    }
  };

  const getSportEmoji = (sport: string) => {
    const option = SPORT_OPTIONS.find((s) => s.value === sport);
    return option?.emoji || '\u{1F3C6}';
  };

  // Loading state
  if (!isLoaded || isCheckingCreds) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not signed in
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-semibold">Sign in to manage leagues</h1>
            <p className="text-muted-foreground">
              Sign in to connect your ESPN fantasy leagues.
            </p>
          </div>
          <SignIn routing="hash" fallbackRedirectUrl="/leagues" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Leagues</h1>
          </div>
          <p className="text-muted-foreground">
            Connect your ESPN fantasy leagues to use with Claude or ChatGPT.
          </p>
        </div>

        {/* Leagues Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Your Leagues</CardTitle>
            <CardDescription>
              Add your ESPN fantasy leagues. Enter a league ID to verify and select your team.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {leagueError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{leagueError}</AlertDescription>
              </Alert>
            )}

            {leagueNotice && (
              <Alert className="bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{leagueNotice}</AlertDescription>
              </Alert>
            )}

            {/* Verification result */}
            {verifiedLeague ? (
              <div className="p-4 border rounded-lg bg-muted/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="font-medium">League verified</span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={handleCancelVerification}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{getSportEmoji(verifiedLeague.sport)}</span>
                    <div>
                      <div className="font-medium">{verifiedLeague.leagueName}</div>
                      <div className="text-sm text-muted-foreground">
                        {verifiedLeague.seasonYear} Season
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Select Your Team</Label>
                  <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose your team..." />
                    </SelectTrigger>
                    <SelectContent>
                      {verifiedLeague.teams.map((team, index) => {
                        // Use index as fallback to guarantee unique keys/values
                        const uniqueId = team.id || String(index + 1);
                        return (
                          <SelectItem key={`team-${index}-${uniqueId}`} value={uniqueId}>
                            {team.name}
                            {team.owner && (
                              <span className="text-muted-foreground ml-2">({team.owner})</span>
                            )}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={handleAddVerifiedLeague}
                    disabled={isAddingLeague || !selectedTeamId}
                  >
                    {isAddingLeague ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Adding...
                      </>
                    ) : (
                      'Add League'
                    )}
                  </Button>
                  <Button variant="outline" onClick={handleCancelVerification}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              /* Add League Form */
              <div className="space-y-2">
                {/* Quick season toggles */}
                {(newLeagueSport === 'baseball' || newLeagueSport === 'football') && (
                  <div className="flex gap-2">
                    <Button
                      variant={newLeagueSeason === getDefaultSeasonYear(newLeagueSport as SeasonSport) ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        const sport = newLeagueSport as SeasonSport;
                        setNewLeagueSeason(getDefaultSeasonYear(sport));
                        setSeasonManuallySet(false);
                      }}
                      disabled={isVerifying}
                    >
                      This season
                    </Button>
                    <Button
                      variant={newLeagueSeason === getDefaultSeasonYear(newLeagueSport as SeasonSport) - 1 ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        const sport = newLeagueSport as SeasonSport;
                        setNewLeagueSeason(getDefaultSeasonYear(sport) - 1);
                        setSeasonManuallySet(true);
                      }}
                      disabled={isVerifying}
                    >
                      Last season
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder="League ID (e.g., 12345678)"
                    value={newLeagueId}
                    onChange={(e) => setNewLeagueId(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && hasCredentials && handleVerifyLeague()}
                    disabled={isVerifying}
                  />
                </div>
                <Select
                  value={newLeagueSport}
                  onValueChange={(v) => {
                    const sport = v as Sport;
                    setNewLeagueSport(sport);
                    // Update season year when sport changes (unless manually overridden)
                    if (!seasonManuallySet && (sport === 'baseball' || sport === 'football')) {
                      setNewLeagueSeason(getDefaultSeasonYear(sport));
                    }
                  }}
                  disabled={isVerifying}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SPORT_OPTIONS.map((sport) => (
                      <SelectItem key={sport.value} value={sport.value}>
                        {sport.emoji} {sport.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(newLeagueSeason)}
                  onValueChange={(v) => {
                    setNewLeagueSeason(Number(v));
                    setSeasonManuallySet(true);
                  }}
                  disabled={isVerifying}
                >
                  <SelectTrigger className="w-[90px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEASON_OPTIONS.map((year) => (
                      <SelectItem key={year} value={String(year)}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleVerifyLeague}
                  disabled={isVerifying || !hasCredentials || !newLeagueId.trim()}
                >
                  {isVerifying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
                </div>
              </div>
            )}

            {!hasCredentials && !verifiedLeague && (
              <p className="text-sm text-muted-foreground">
                Sync your ESPN credentials using the Chrome extension before adding leagues.
              </p>
            )}

            {/* Leagues List */}
            {isLoadingLeagues ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : leagueGroups.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Trophy className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No leagues added yet</p>
                <p className="text-sm">Enter a league ID above to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {leagueGroups.map((group) => {
                  const baseKey = `${group.leagueId}-${group.sport}`;
                  const isDeleting = deletingLeagueKey === baseKey;
                  const isDiscovering = discoveringLeagueKey === baseKey;
                  const canDiscover = group.sport === 'baseball' || group.sport === 'football';
                  const isExpanded = expandedGroups.has(group.key);
                  const visibleSeasons = isExpanded ? group.seasons : group.seasons.slice(0, 3);
                  const hasMoreSeasons = group.seasons.length > 3;
                  const hasTeamSelection = group.seasons.some((season) => !!season.teamId);

                  return (
                    <div key={group.key} className="rounded-lg border bg-card">
                      {/* Group Header */}
                      <div className="flex items-center justify-between p-3 border-b">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{getSportEmoji(group.sport)}</span>
                          <div>
                            <div className="font-medium">
                              {group.leagueName || `League ${group.leagueId}`}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              ID: {group.leagueId} • {group.seasons.length} season{group.seasons.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {canDiscover && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-primary"
                              onClick={() => handleDiscoverSeasons(group.leagueId, group.sport)}
                              disabled={isDiscovering || !!discoveringLeagueKey || !hasTeamSelection}
                              title={
                                !hasTeamSelection
                                  ? 'Select a team first'
                                  : 'Discover historical seasons'
                              }
                            >
                              {isDiscovering ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <History className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteLeague(group.leagueId, group.sport)}
                            disabled={isDeleting}
                            title="Delete all seasons"
                          >
                            {isDeleting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* Season Chips */}
                      <div className="p-3">
                        <div className="flex flex-wrap gap-2">
                          {visibleSeasons.map((season) => {
                            const seasonKey = `${season.leagueId}-${season.sport}-${season.seasonYear || 'all'}`;
                            const isSettingDefault = settingDefaultKey === seasonKey;

                            return (
                              <div
                                key={seasonKey}
                                className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                                  season.isDefault
                                    ? 'bg-primary/10 border border-primary/30'
                                    : 'bg-muted'
                                }`}
                              >
                                <div className="flex flex-col">
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium">{season.seasonYear || 'Unknown'}</span>
                                    {season.isDefault && (
                                      <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                                        Default
                                      </span>
                                    )}
                                  </div>
                                  {season.teamName && (
                                    <span className="text-xs text-muted-foreground">{season.teamName}</span>
                                  )}
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className={`h-6 w-6 ${
                                    season.isDefault
                                      ? 'text-yellow-500'
                                      : 'text-muted-foreground hover:text-yellow-500'
                                  }`}
                                  onClick={() => handleSetDefault(season.leagueId, season.sport, season.seasonYear)}
                                  disabled={isSettingDefault || season.isDefault || !season.teamId}
                                  title={
                                    !season.teamId
                                      ? 'Select a team first'
                                      : season.isDefault
                                      ? 'Already default'
                                      : 'Set as default'
                                  }
                                >
                                  {isSettingDefault ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Star className={`h-3 w-3 ${season.isDefault ? 'fill-current' : ''}`} />
                                  )}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                        {hasMoreSeasons && (
                          <button
                            type="button"
                            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => toggleGroup(group.key)}
                          >
                            {isExpanded
                              ? 'Show less'
                              : `Show all (${group.seasons.length})`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* How to find league ID */}
            <div className="border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Find your league ID in the ESPN URL: <code className="bg-muted px-1 rounded">espn.com/fantasy/football/league?leagueId=<strong>12345678</strong></code>
              </p>
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
