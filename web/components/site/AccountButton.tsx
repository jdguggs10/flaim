"use client";

import { useClerk } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';

export function AccountButton() {
  const clerk = useClerk();

  return (
    <Button
      type="button"
      variant="ghost"
      className="text-sm"
      onClick={() => clerk.openUserProfile?.()}
    >
      Account
    </Button>
  );
}
