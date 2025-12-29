"use client";

import React, { useEffect, useState } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
  X,
  Star,
} from 'lucide-react';

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

const SPORT_OPTIONS: { value: Sport; label: string; emoji: string }[] = [
  { value: 'football', label: 'Football', emoji: '\u{1F3C8}' },
  { value: 'baseball', label: 'Baseball', emoji: '\u26BE' },
];

export default function LeaguesPage() {
  const { isLoaded, isSignedIn } = useAuth();

  // Credentials state
  const [hasCredentials, setHasCredentials] = useState(false);
  const [isEditingCreds, setIsEditingCreds] = useState(false);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [credsSaving, setCredsSaving] = useState(false);
  const [credsError, setCredsError] = useState<string | null>(null);
  const [credsSuccess, setCredsSuccess] = useState(false);
  const [showCredsHelp, setShowCredsHelp] = useState(false);

  // Leagues state
  const [leagues, setLeagues] = useState<League[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(true);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [deletingLeagueKey, setDeletingLeagueKey] = useState<string | null>(null);
  const [settingDefaultKey, setSettingDefaultKey] = useState<string | null>(null);

  // Add league flow state
  const [newLeagueId, setNewLeagueId] = useState('');
  const [newLeagueSport, setNewLeagueSport] = useState<Sport>('football');
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedLeague, setVerifiedLeague] = useState<VerifiedLeague | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isAddingLeague, setIsAddingLeague] = useState(false);

  // Initial loading
  const [isCheckingCreds, setIsCheckingCreds] = useState(true);

  // Load credentials on mount
  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsCheckingCreds(false);
      setIsLoadingLeagues(false);
      return;
    }

    const loadData = async () => {
      // Check credentials
      try {
        const credsRes = await fetch('/api/auth/espn/credentials');
        if (credsRes.ok) {
          const data = await credsRes.json() as { hasCredentials?: boolean };
          setHasCredentials(!!data.hasCredentials);
        }
      } catch (err) {
        console.error('Failed to check credentials:', err);
      } finally {
        setIsCheckingCreds(false);
      }

      // Load leagues
      try {
        const leaguesRes = await fetch('/api/onboarding/espn/leagues');
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

  // Fetch credentials for editing
  const handleEditCredentials = async () => {
    setIsLoadingCreds(true);
    setCredsError(null);

    try {
      const res = await fetch('/api/auth/espn/credentials?forEdit=true');
      if (res.ok) {
        const data = await res.json() as { hasCredentials?: boolean; swid?: string; s2?: string };
        if (data.swid) setSwid(data.swid);
        if (data.s2) setEspnS2(data.s2);
      }
    } catch (err) {
      console.error('Failed to fetch credentials for editing:', err);
    } finally {
      setIsLoadingCreds(false);
      setIsEditingCreds(true);
    }
  };

  // Save credentials
  const handleSaveCredentials = async () => {
    if (!swid.trim() || !espnS2.trim()) {
      setCredsError('Both SWID and ESPN_S2 are required');
      return;
    }

    setCredsSaving(true);
    setCredsError(null);

    try {
      const res = await fetch('/api/auth/espn/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swid: swid.trim(), s2: espnS2.trim() }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to save credentials');
      }

      setHasCredentials(true);
      setIsEditingCreds(false);
      setSwid('');
      setEspnS2('');
      setCredsSuccess(true);
      setTimeout(() => setCredsSuccess(false), 3000);
    } catch (err) {
      setCredsError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setCredsSaving(false);
    }
  };

  // Verify league (call auto-pull to get league info)
  const handleVerifyLeague = async () => {
    if (!hasCredentials) {
      setLeagueError('Add your ESPN credentials first');
      return;
    }

    if (!newLeagueId.trim()) {
      setLeagueError('League ID is required');
      return;
    }

    // Check for duplicates
    const exists = leagues.some(
      (l) => l.leagueId === newLeagueId.trim() && l.sport === newLeagueSport
    );
    if (exists) {
      setLeagueError('This league is already added');
      return;
    }

    setIsVerifying(true);
    setLeagueError(null);
    setVerifiedLeague(null);
    setSelectedTeamId('');

    try {
      const res = await fetch('/api/onboarding/espn/auto-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: newLeagueSport,
          leagueId: newLeagueId.trim(),
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
        teams: data.leagueInfo.teams.map((t) => ({
          id: String(t.id),
          name: t.name,
          owner: t.owner,
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

      const res = await fetch('/api/onboarding/espn/leagues', {
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

  // Delete league
  const handleDeleteLeague = async (leagueId: string, sport: string) => {
    const leagueKey = `${leagueId}-${sport}`;
    setDeletingLeagueKey(leagueKey);

    try {
      const res = await fetch(
        `/api/onboarding/espn/leagues?leagueId=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(sport)}`,
        { method: 'DELETE' }
      );

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to remove league');
      }

      setLeagues(leagues.filter((l) => !(l.leagueId === leagueId && l.sport === sport)));
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to remove league');
    } finally {
      setDeletingLeagueKey(null);
    }
  };

  // Set default league
  const handleSetDefault = async (leagueId: string, sport: string) => {
    const leagueKey = `${leagueId}-${sport}`;
    setSettingDefaultKey(leagueKey);
    setLeagueError(null);

    try {
      const res = await fetch('/api/onboarding/espn/leagues/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, sport }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to set default league');
      }

      const data = await res.json() as { leagues?: League[] };
      if (data.leagues) {
        setLeagues(data.leagues);
      } else {
        // Fallback: update locally using functional update to avoid stale closure
        setLeagues((prev) => prev.map((l) => ({
          ...l,
          isDefault: l.leagueId === leagueId && l.sport === sport,
        })));
      }
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to set default league');
    } finally {
      setSettingDefaultKey(null);
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

        {/* Success Alert */}
        {credsSuccess && (
          <Alert className="bg-green-50 border-green-200 text-green-800 dark:bg-green-900/20 dark:border-green-800 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            <AlertTitle>Success</AlertTitle>
            <AlertDescription>ESPN credentials saved successfully.</AlertDescription>
          </Alert>
        )}

        {/* Credentials Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">ESPN Credentials</CardTitle>
            <CardDescription>
              Your ESPN authentication cookies are required to access your leagues.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasCredentials && !isEditingCreds ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <span className="font-medium">Credentials saved</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleEditCredentials}
                    disabled={isLoadingCreds}
                  >
                    {isLoadingCreds ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Update'
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {credsError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{credsError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="swid">SWID</Label>
                  <div className="relative">
                    <Input
                      id="swid"
                      type={showCredentials ? 'text' : 'password'}
                      placeholder="Enter your SWID"
                      value={swid}
                      onChange={(e) => setSwid(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8"
                      onClick={() => setShowCredentials(!showCredentials)}
                    >
                      {showCredentials ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="espn_s2">ESPN_S2</Label>
                  <Input
                    id="espn_s2"
                    type={showCredentials ? 'text' : 'password'}
                    placeholder="Enter your ESPN_S2"
                    value={espnS2}
                    onChange={(e) => setEspnS2(e.target.value)}
                  />
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleSaveCredentials} disabled={credsSaving}>
                    {credsSaving ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save Credentials'
                    )}
                  </Button>
                  {isEditingCreds && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsEditingCreds(false);
                        setSwid('');
                        setEspnS2('');
                        setCredsError(null);
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* How to find credentials */}
            <div className="border-t pt-4">
              <button
                type="button"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowCredsHelp(!showCredsHelp)}
              >
                {showCredsHelp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                How to find your ESPN credentials
              </button>
              {showCredsHelp && (
                <div className="mt-3 p-4 bg-muted rounded-lg text-sm space-y-3">
                  <ol className="list-decimal list-inside space-y-2">
                    <li>Log in to <a href="https://espn.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">espn.com</a></li>
                    <li>Open browser Developer Tools (F12 or right-click &gt; Inspect)</li>
                    <li>Go to Application &gt; Cookies &gt; espn.com</li>
                    <li>Find and copy the values for <code className="bg-background px-1 rounded">SWID</code> and <code className="bg-background px-1 rounded">espn_s2</code></li>
                  </ol>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href="https://support.espn.com/hc/en-us"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-3 w-3 mr-1" />
                      ESPN Help Center
                    </a>
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

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
                      {verifiedLeague.teams.map((team, index) => (
                        <SelectItem key={team.id || `team-${index}`} value={team.id || String(index)}>
                          {team.name}
                          {team.owner && (
                            <span className="text-muted-foreground ml-2">({team.owner})</span>
                          )}
                        </SelectItem>
                      ))}
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
                  onValueChange={(v) => setNewLeagueSport(v as Sport)}
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
            )}

            {!hasCredentials && !verifiedLeague && (
              <p className="text-sm text-muted-foreground">
                Add your ESPN credentials above before adding leagues.
              </p>
            )}

            {/* Leagues List */}
            {isLoadingLeagues ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : leagues.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Trophy className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No leagues added yet</p>
                <p className="text-sm">Enter a league ID above to get started</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leagues.map((league) => {
                  const leagueKey = `${league.leagueId}-${league.sport}`;
                  const isSettingDefault = settingDefaultKey === leagueKey;
                  const isDeleting = deletingLeagueKey === leagueKey;

                  return (
                    <div
                      key={leagueKey}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        league.isDefault ? 'bg-primary/10 border border-primary/30' : 'bg-muted'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{getSportEmoji(league.sport)}</span>
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            {league.leagueName || `League ${league.leagueId}`}
                            {league.isDefault && (
                              <span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded-full">
                                Default
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {league.teamName ? (
                              <span>{league.teamName}</span>
                            ) : (
                              <span className="capitalize">{league.sport}</span>
                            )}
                            {' | ID: '}{league.leagueId}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`h-8 w-8 ${
                            league.isDefault
                              ? 'text-yellow-500 hover:text-yellow-600'
                              : 'text-muted-foreground hover:text-yellow-500'
                          }`}
                          onClick={() => handleSetDefault(league.leagueId, league.sport)}
                          disabled={isSettingDefault || league.isDefault || !league.teamId}
                          title={
                            !league.teamId
                              ? 'Select a team first'
                              : league.isDefault
                              ? 'Already default'
                              : 'Set as default'
                          }
                        >
                          {isSettingDefault ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Star
                              className={`h-4 w-4 ${league.isDefault ? 'fill-current' : ''}`}
                            />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteLeague(league.leagueId, league.sport)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
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

        {/* Next steps */}
        {hasCredentials && leagues.length > 0 && (
          <Card className="border-primary/50">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-primary mt-0.5" />
                <div>
                  <h3 className="font-medium">Ready to connect!</h3>
                  <p className="text-sm text-muted-foreground">
                    Your leagues are set up. Head to{' '}
                    <a href="/connectors" className="text-primary hover:underline">
                      Connectors
                    </a>{' '}
                    to connect Claude or ChatGPT.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
