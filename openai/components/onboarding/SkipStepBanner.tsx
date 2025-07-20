import React from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';

export default function SkipStepBanner({ text, onSkip }: { text: string; onSkip: () => void }) {
  return (
    <Alert className="flex items-center justify-between bg-primary/10 border-primary/20">
      <div className="flex items-center gap-2">
        <CheckCircle className="h-4 w-4 text-primary" />
        <AlertDescription className="text-sm">{text}</AlertDescription>
      </div>
      <Button size="sm" variant="outline" onClick={onSkip}>
        Skip
      </Button>
    </Alert>
  );
} 