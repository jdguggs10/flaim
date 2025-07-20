"use client";

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { CheckCircle, Clock } from 'lucide-react';
import useOnboardingStore, { Platform } from '@/stores/useOnboardingStore';

interface PlatformOption {
  id: Platform;
  name: string;
  description: string;
  logo: string;
  isActive: boolean;
  comingSoon?: boolean;
  features: string[];
  sports: string[];
}

const PLATFORM_OPTIONS: PlatformOption[] = [
  {
    id: 'ESPN',
    name: 'ESPN Fantasy',
    description: 'Connect your ESPN Fantasy account to access all your leagues',
    logo: '🏈', // Will be replaced with actual logo
    isActive: true,
    features: ['League Discovery', 'Team Analysis', 'Matchup Insights', 'Player Stats'],
    sports: ['Baseball', 'Football', 'Basketball', 'Hockey']
  },
  {
    id: 'Yahoo',
    name: 'Yahoo Fantasy',
    description: 'Yahoo Fantasy integration coming soon',
    logo: '⚾', // Will be replaced with actual logo
    isActive: false,
    comingSoon: true,
    features: ['League Discovery', 'Team Analysis', 'Trade Analysis', 'Waiver Wire'],
    sports: ['Baseball', 'Football', 'Basketball', 'Hockey']
  }
];

export default function PlatformSelection() {
  const { setSelectedPlatform, selectedPlatform } = useOnboardingStore();

  const handlePlatformSelect = (platformId: Platform) => {
    const platform = PLATFORM_OPTIONS.find(p => p.id === platformId);
    if (platform?.isActive) {
      setSelectedPlatform(platformId);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 w-full">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold text-foreground">Choose Your Fantasy Platform</h1>
        <p className="text-muted-foreground">
          Select the fantasy sports platform you use to manage your leagues
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 w-full">
        {PLATFORM_OPTIONS.map((platform) => (
          <Card 
            key={platform.id}
            className={`relative cursor-pointer transition-all duration-200 hover:shadow-md w-full ${
              selectedPlatform === platform.id 
                ? 'ring-2 ring-primary border-primary' 
                : platform.isActive 
                  ? 'hover:border-primary/50' 
                  : 'opacity-60'
            }`}
            onClick={() => handlePlatformSelect(platform.id)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-2xl">{platform.logo}</div>
                  <div>
                    <CardTitle className="text-lg">{platform.name}</CardTitle>
                    <CardDescription className="text-sm">
                      {platform.description}
                    </CardDescription>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2">
                  {platform.isActive ? (
                    selectedPlatform === platform.id ? (
                      <CheckCircle className="h-5 w-5 text-primary" />
                    ) : (
                      <div className="h-5 w-5" />
                    )
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground" />
                  )}
                  
                  {platform.comingSoon && (
                    <Badge variant="secondary" className="text-xs">
                      Coming Soon
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div>
                <h4 className="font-medium text-sm text-foreground mb-2">Features</h4>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {platform.features.map((feature, index) => (
                    <li key={index} className="flex items-center gap-2">
                      <div className="w-1 h-1 bg-muted-foreground rounded-full" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h4 className="font-medium text-sm text-foreground mb-2">Supported Sports</h4>
                <div className="flex flex-wrap gap-1">
                  {platform.sports.map((sport, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      {sport}
                    </Badge>
                  ))}
                </div>
              </div>

              {!platform.isActive && (
                <div className="pt-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    disabled 
                    className="w-full"
                  >
                    {platform.comingSoon ? 'Coming Soon' : 'Not Available'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {selectedPlatform && (
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            Great choice! {PLATFORM_OPTIONS.find(p => p.id === selectedPlatform)?.name} selected.
          </p>
        </div>
      )}
    </div>
  );
}