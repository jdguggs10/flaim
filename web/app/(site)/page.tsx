import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { User, Check } from 'lucide-react';
import { StepSyncEspn } from '@/components/site/StepSyncEspn';
import { StepConnectAI } from '@/components/site/StepConnectAI';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="py-8 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-2">
          AI Connectors for Fantasy Sports
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Give AI access to your fantasy leagues. Ask questions about your teams, roster, and more.
        </p>
      </section>

      {/* How It Works */}
      <section className="py-8 bg-muted">
        <div className="container max-w-xl mx-auto px-4">
          <div className="flex flex-col gap-4">
            {/* Step 1: Create Account */}
            <div className="bg-background rounded-xl p-5 border flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  1
                </div>
                <h3 className="font-semibold text-lg">Create Account</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Sign up to get started. This is where your ESPN credentials and league info will be stored.
              </p>
              <SignedOut>
                <Link href="/sign-up">
                  <Button className="w-full">
                    <User className="h-4 w-4 mr-2" />
                    Create Account
                  </Button>
                </Link>
              </SignedOut>
              <SignedIn>
                <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                  <Check className="h-4 w-4" />
                  Signed in
                </div>
              </SignedIn>
            </div>

            {/* Step 2: Sync ESPN */}
            <StepSyncEspn />

            {/* Step 3: Connect AI */}
            <StepConnectAI />

            {/* Completion message */}
            <p className="text-center text-sm text-muted-foreground pt-2">
              Boom, you&apos;re done. Use your AI as normal and it will pull data from your fantasy league via Flaim. Enjoy.
            </p>
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="py-8 px-4">
        <div className="container max-w-2xl mx-auto">
          <h2 className="text-2xl font-bold text-center mb-5">FAQs</h2>
          <div className="space-y-3">
            {/* How the Extension Works */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does the Chrome extension work?
                <span className="ml-2 transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p><strong>1.</strong> Install the extension from the Chrome Web Store.</p>
                <p><strong>2.</strong> Sign in to flaim.app - your session automatically syncs to the extension.</p>
                <p><strong>3.</strong> Log into ESPN (espn.com/fantasy) in any tab.</p>
                <p><strong>4.</strong> Click the extension and tap &quot;Sync to Flaim&quot; to capture your ESPN credentials.</p>
              </div>
            </details>

            {/* How Connectors Work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How do I connect to Claude or ChatGPT?
                <span className="ml-2 transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Copy an MCP URL above on this page, then follow your AI platform&apos;s setup guide to add it as a connector. You&apos;ll be redirected to Flaim to authorize access. Connections auto-renew so you stay connected.</p>
              </div>
            </details>

            {/* Tips and tricks */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Any other tips or tricks?
                <span className="ml-2 transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>You can &quot;force&quot; your AI to activate the connector by saying &quot;Use Flaim.&quot; at the end of your message.</p>
              </div>
            </details>

            {/* How does this work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does this work?
                <span className="ml-2 transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Flaim is a middleware service that provides MCP servers and manages unique user auth, allowing your personal AI to directly retrieve data from your fantasy leagues. See <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> for more.</p>
              </div>
            </details>
          </div>
        </div>
      </section>

    </div>
  );
}
