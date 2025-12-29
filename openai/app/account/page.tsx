"use client";

import { UserProfile } from '@clerk/nextjs';

export default function AccountPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto py-8 px-4">
        <h1 className="text-2xl font-semibold mb-6">Account Settings</h1>
        <UserProfile
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "shadow-none border rounded-lg",
            },
          }}
        />
      </div>
    </div>
  );
}
