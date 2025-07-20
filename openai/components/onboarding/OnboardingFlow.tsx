"use client";

import React from 'react';
// Removed unused Card imports
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { AlertCircle, ArrowLeft } from 'lucide-react';
import useOnboardingStore from '@/stores/useOnboardingStore';
import PlatformSelection from './PlatformSelection';
import EspnLeagueForm from './EspnLeagueForm';
import LeagueList from './LeagueList';
import AutoPullSummary from './AutoPullSummary';
import SetupComplete from './SetupComplete';

// Legacy components (deprecated)
import EspnAuth from './auth/EspnAuth';
import LeagueDiscovery from './LeagueDiscovery';
import LeagueSelector from './LeagueSelector';
import useHasMounted from '@/hooks/useHasMounted';

export default function OnboardingFlow() {
  // Prevent SSR–client HTML mismatch while keeping hook order intact
  const hasMounted = useHasMounted();

  const { 
    step, 
    selectedPlatform, 
    espnLeagues,
    isComplete,
    error,
    goToPreviousStep,
    
    // Legacy compatibility
    platformCredentials: _platformCredentials, 
    discoveredLeagues,
    selectedLeague,
    setStep,
    completeOnboarding
  } = useOnboardingStore();

  // Determine which component to render based on current step
  const getCurrentStep = () => {
    switch (step) {
      case 'NOT_STARTED':
      case 'PLATFORM_SELECTION':
        return <PlatformSelection />;
        
      case 'LEAGUE_ENTRY':
        if (selectedPlatform === 'ESPN') {
          return <EspnLeagueForm />;
        }
        // Yahoo auth would go here in the future
        return <PlatformSelection />;
        
      case 'CONFIRMATION':
        return <LeagueList />;
        
      case 'AUTO_PULL':
        return <AutoPullSummary />;
        
      case 'COMPLETED':
        return <SetupComplete />;
        
      // Legacy step support (deprecated but maintained for compatibility)
      case 'PLATFORM_AUTH':
        if (selectedPlatform === 'ESPN') {
          return <EspnAuth />;
        }
        return <PlatformSelection />;
        
      case 'LEAGUE_SELECTION':
        if (discoveredLeagues.length === 0) {
          return <LeagueDiscovery />;
        }
        return <LeagueSelector />;
        
      default:
        return <PlatformSelection />;
    }
  };

  // Get step progress information
  const getStepInfo = () => {
    const steps = [
      {
        id: 'platform',
        title: 'Choose Platform',
        completed: !!selectedPlatform,
        current: step === 'PLATFORM_SELECTION' || step === 'NOT_STARTED'
      },
      {
        id: 'leagues',
        title: 'Add Leagues',
        completed: espnLeagues.length > 0,
        current: step === 'LEAGUE_ENTRY'
      },
      {
        id: 'setup',
        title: 'Configure Teams',
        completed: espnLeagues.some(l => !!l.teamId),
        current: step === 'CONFIRMATION' || step === 'AUTO_PULL'
      },
      {
        id: 'complete',
        title: 'Setup Complete',
        completed: isComplete,
        current: step === 'COMPLETED'
      }
    ];

    // Handle legacy steps for backward compatibility
    if (step === 'PLATFORM_AUTH' || step === 'LEAGUE_SELECTION') {
      const legacySteps = [
        {
          id: 'platform',
          title: 'Choose Platform',
          completed: !!selectedPlatform,
          current: false // Platform was already selected to get to these legacy steps
        },
        {
          id: 'auth',
          title: 'Connect Account',
          completed: !!_platformCredentials,
          current: step === 'PLATFORM_AUTH'
        },
        {
          id: 'leagues',
          title: 'Select League',
          completed: !!selectedLeague,
          current: step === 'LEAGUE_SELECTION'
        },
        {
          id: 'complete',
          title: 'Setup Complete',
          completed: isComplete,
          current: false // Not completed yet if we're in legacy flow
        }
      ];
      const currentStepIndex = legacySteps.findIndex(s => s.current);
      return { steps: legacySteps, currentStepIndex };
    }

    const currentStepIndex = steps.findIndex(s => s.current);
    return { steps, currentStepIndex };
  };

  // Remove unused destructured variables - we don't use steps/currentStepIndex in the render
  getStepInfo();

  // Determine if back button should be shown
  const canGoBack = () => {
    // Can't go back from first step or NOT_STARTED
    if (step === 'NOT_STARTED' || step === 'PLATFORM_SELECTION') {
      return false;
    }
    
    // Can't go back from COMPLETED step
    if (step === 'COMPLETED') {
      return false;
    }
    
    // Can go back from all other steps
    return true;
  };

  const handleGoBack = () => {
    if (canGoBack()) {
      goToPreviousStep();
    }
  };

  if (!hasMounted) {
    return <div className="min-h-screen bg-background p-4" />;
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header removed – no spacer needed */}

        {/* Back Button (optional) */}
        {(canGoBack() || true) && (
          <div className="flex items-center justify-between mb-4">
            {canGoBack() ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleGoBack}
                className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="w-4 h-4" />
                Go Back
              </Button>
            ) : <span />}

            {(() => {
              // Determine if we should show a skip button for the current step
              const hasCreds = !!_platformCredentials?.espn || espnLeagues.length > 0; // creds saved earlier
              const leaguesImported = espnLeagues.length > 0;
              const allTeamsSelected = espnLeagues.length > 0 && espnLeagues.every(l => !!l.teamId);
              if (step === 'PLATFORM_AUTH' && hasCreds) {
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep('LEAGUE_ENTRY')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Skip
                  </Button>
                );
              }
              if (step === 'LEAGUE_ENTRY' && leaguesImported) {
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep('CONFIRMATION')}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Skip
                  </Button>
                );
              }
              if (step === 'CONFIRMATION' && allTeamsSelected) {
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={completeOnboarding}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Skip
                  </Button>
                );
              }
              return null;
            })()}
          </div>
        )}

        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Main Content */}
        <div className="space-y-6">
          {getCurrentStep()}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground">
          <p>
            Need help? Your data is secure and encrypted. We only access your fantasy information to provide insights.
          </p>
        </div>
      </div>
    </div>
  );
}