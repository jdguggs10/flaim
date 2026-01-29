import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { User, Check } from 'lucide-react';
import { StepConnectPlatforms } from '@/components/site/StepConnectPlatforms';
import { StepConnectAI } from '@/components/site/StepConnectAI';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="py-8 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-2">
          MCP Connectors for Fantasy Sports
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Give AI access to your fantasy leagues. Ask questions about your teams, roster, free agents, and more.
        </p>
      </section>

      {/* How It Works */}
      <section className="py-8 bg-muted">
        <div className="container max-w-xl mx-auto px-4">
          <div className="flex flex-col gap-4">
            {/* Step 1: Create Account */}
            <Card className="p-5 flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                  1
                </div>
                <h3 className="font-semibold text-lg">Create Account</h3>
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Sign up to get started. This is where your platform credentials and league info will be stored.
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
                <div className="flex items-center gap-2 text-sm text-success font-medium">
                  <Check className="h-4 w-4" />
                  Signed in
                </div>
              </SignedIn>
            </Card>

            {/* Step 2: Connect Platforms */}
            <StepConnectPlatforms />

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
            {/* What does Flaim do */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                What does Flaim do?
                <span className="ml-2 transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Flaim provides MCP servers and user auth so you can connect your fantasy leagues to your preferred AI. That&apos;s it. I don&apos;t supply the AI, you do. I just connect the dots.</p>
              </div>
            </details>

            {/* How does the extension work */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                How does the extension work?
                <span className="ml-2 transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>It makes grabbing your credentials easy and matches them to your account. The MCPs will then auth the AI&apos;s data request with those credentials.</p>
              </div>
            </details>

            {/* Why custom connectors */}
            <details className="group border rounded-lg bg-background">
              <summary className="flex cursor-pointer items-center justify-between p-4 font-medium">
                Why do you use custom connectors with only some AIs?
                <span className="ml-2 transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="px-4 pb-4 text-sm text-muted-foreground space-y-2">
                <p>Because how AIs connect with external data is brand new technology, the MCP protocol was just created in late 2024, and standard implementations are still forming. Trust me, I&apos;ll add ChatGPT and Gemini as soon as I can.</p>
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

          </div>
        </div>
      </section>

    </div>
  );
}
