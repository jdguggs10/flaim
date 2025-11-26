"use client";

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Button, Input, Label, Alert, AlertDescription } from '@/components/ui';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';
import { Loader2, Plus } from 'lucide-react';
import useOnboardingStore from '@/stores/useOnboardingStore';
import type { SportName } from '@/lib/espn-types';
import SkipStepBanner from './SkipStepBanner';

interface SaveLeagueResponse {
  success?: boolean;
  error?: string;
}

export default function EspnLeagueForm() {
  const [formData, setFormData] = useState({
    leagueId: '',
    sport: '' as SportName | ''
  });
  const [leagues, setLeagues] = useState<Array<{ leagueId: string; sport: SportName }>>([]);

  const {
    setError,
    error,
    isAutoSaving,
    setIsAutoSaving,
    setStep,
    addEspnLeague,
    espnLeagues
  } = useOnboardingStore();

  const sports: { value: SportName; label: string; emoji: string }[] = [
    { value: 'football', label: 'Football', emoji: '🏈' },
    { value: 'baseball', label: 'Baseball', emoji: '⚾' },
    { value: 'basketball', label: 'Basketball', emoji: '🏀' },
    { value: 'hockey', label: 'Hockey', emoji: '🏒' }
  ];

  const handleInputChange = (field: keyof typeof formData, value: string) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);
    if (error) setError(null);
  };

  const validateForm = (): string[] => {
    const errors: string[] = [];

    if (!formData.leagueId.trim()) {
      errors.push('League ID is required');
    }

    if (!formData.sport) {
      errors.push('Sport selection is required');
    }

    // Check for duplicates in local state
    if (formData.leagueId && formData.sport) {
      const exists = leagues.some(league =>
        league.leagueId === formData.leagueId.trim() && league.sport === formData.sport
      );
      if (exists) {
        errors.push(`League ${formData.leagueId} for ${formData.sport} already exists`);
      }
    }

    return errors;
  };

  const addLeague = () => {
    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      setError(validationErrors.join(', '));
      return;
    }

    if (leagues.length >= 10) {
      setError('Maximum of 10 leagues allowed');
      return;
    }

    const newLeague = {
      leagueId: formData.leagueId.trim(),
      sport: formData.sport as SportName
    };

    setLeagues([...leagues, newLeague]);
    setFormData({ leagueId: '', sport: '' });
    setError(null);
  };

  const removeLeague = (index: number) => {
    setLeagues(leagues.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (leagues.length === 0) {
      setError('Please add at least one league');
      return;
    }

    setIsAutoSaving(true);
    setError(null);

    try {
      // Combine existing leagues already in KV with new ones to avoid overwriting
      const existing = espnLeagues.map(l => ({ leagueId: l.leagueId, sport: l.sport }));
      const combined: Array<{ leagueId: string; sport: string }> = [...existing];
      for (const l of leagues) {
        if (!combined.some(e => e.leagueId === l.leagueId && e.sport === l.sport)) {
          combined.push(l);
        }
      }

      // Save combined list to auth-worker (Supabase)
      const response = await fetch('/api/onboarding/espn/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: combined })
      });

      const data = await response.json() as SaveLeagueResponse;

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save leagues');
      }

      if (data.success) {
        // Add each new league to the global store (handles duplicates internally)
        leagues.forEach((l) => {
          addEspnLeague({ leagueId: l.leagueId, sport: l.sport } as any);
        });

        // Clear local form state
        setLeagues([]);

        console.log(`✅ Successfully saved ${leagues.length} leagues`);
        setStep('CONFIRMATION');
      }

    } catch (error) {
      console.error('League save error:', error);
      setError(error instanceof Error ? error.message : 'Failed to save leagues');
    } finally {
      setIsAutoSaving(false);
    }
  };

  if (leagues.length >= 10) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-4">
            <h3 className="text-lg font-semibold">Maximum Leagues Reached</h3>
            <p className="text-muted-foreground">
              You&apos;ve reached the maximum of 10 leagues.
            </p>
            <Button onClick={() => setStep('CONFIRMATION')}>
              Continue to Summary
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {espnLeagues.length > 0 && (
        <SkipStepBanner
          text="Leagues already imported."
          onSkip={() => setStep('CONFIRMATION')}
        />
      )}
      <div className="text-center space-y-2">
        <div className="flex items-center justify-center gap-2">
          <div className="text-2xl">🏈</div>
          <h1 className="text-2xl font-bold text-foreground">Add ESPN Leagues</h1>
        </div>
        <p className="text-muted-foreground">
          Enter the League ID and sport for each ESPN league you want to track
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Add League
          </CardTitle>
          <CardDescription>
            Enter your ESPN league ID and select the sport
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="leagueId">League ID</Label>
              <Input
                id="leagueId"
                type="text"
                placeholder="e.g., 12345678"
                value={formData.leagueId}
                onChange={(e) => handleInputChange('leagueId', e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sport">Sport</Label>
              <Select
                value={formData.sport}
                onValueChange={(value: SportName) => handleInputChange('sport', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select sport" />
                </SelectTrigger>
                <SelectContent>
                  {sports.map(sport => (
                    <SelectItem key={sport.value} value={sport.value}>
                      <span className="flex items-center gap-2">
                        <span>{sport.emoji}</span>
                        <span>{sport.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            type="button"
            onClick={addLeague}
            disabled={!formData.leagueId.trim() || !formData.sport || leagues.length >= 10}
            className="w-full"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add League
          </Button>
        </CardContent>
      </Card>

      {leagues.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Your Leagues ({leagues.length}/10)</CardTitle>
            <CardDescription>
              These leagues will be processed in the next step
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {leagues.map((league, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">
                      {sports.find(s => s.value === league.sport)?.emoji}
                    </span>
                    <div>
                      <div className="font-medium">League {league.leagueId}</div>
                      <div className="text-sm text-muted-foreground capitalize">
                        {league.sport}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeLeague(index)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button
          onClick={handleSubmit}
          className="flex-1"
          disabled={isAutoSaving || leagues.length === 0}
        >
          {isAutoSaving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving Leagues...
            </>
          ) : (
            `Save ${leagues.length} League${leagues.length !== 1 ? 's' : ''}`
          )}
        </Button>
      </div>
    </div>
  );
}