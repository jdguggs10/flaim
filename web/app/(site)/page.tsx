import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <section className="py-20 px-4 text-center">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">
          Fantasy Sports Context for Your AI
        </h1>
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          Connect Claude or ChatGPT to your ESPN fantasy leagues.
          Bring your own AI subscription - we provide the data.
        </p>
        <SignedOut>
          <Link href="/sign-up">
            <Button size="lg">Get Started</Button>
          </Link>
        </SignedOut>
        <SignedIn>
          <Link href="/leagues">
            <Button size="lg">Go to Dashboard</Button>
          </Link>
        </SignedIn>
      </section>

      {/* How it works */}
      <section className="py-16 bg-muted">
        <div className="container max-w-4xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-center mb-8">How It Works</h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">
                1
              </div>
              <h3 className="font-semibold mb-1">Connect ESPN</h3>
              <p className="text-sm text-muted-foreground">
                Add your ESPN credentials to access your leagues
              </p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">
                2
              </div>
              <h3 className="font-semibold mb-1">Add Connector</h3>
              <p className="text-sm text-muted-foreground">
                Copy the MCP URL to Claude or ChatGPT
              </p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center mx-auto mb-3 font-bold">
                3
              </div>
              <h3 className="font-semibold mb-1">Ask Away</h3>
              <p className="text-sm text-muted-foreground">
                Get insights about your fantasy teams
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Supported Platforms */}
      <section className="py-16 px-4">
        <div className="container max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-6">Supported Platforms</h2>
          <div className="flex justify-center gap-12 mb-4">
            <div className="text-center">
              <div className="text-3xl mb-2">{'\u{1F3C8}'}</div>
              <div className="font-medium">Football</div>
            </div>
            <div className="text-center">
              <div className="text-3xl mb-2">{'\u26BE'}</div>
              <div className="font-medium">Baseball</div>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            ESPN Fantasy supported. Yahoo and Sleeper coming soon.
          </p>
        </div>
      </section>

      {/* AI Platforms */}
      <section className="py-16 bg-muted px-4">
        <div className="container max-w-4xl mx-auto text-center">
          <h2 className="text-2xl font-bold mb-6">Works With</h2>
          <div className="flex justify-center gap-8 mb-4">
            <div className="px-6 py-3 bg-background rounded-lg border font-medium">
              Claude
            </div>
            <div className="px-6 py-3 bg-background rounded-lg border font-medium">
              ChatGPT
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Use your existing AI subscription. Flaim provides the fantasy data connection.
          </p>
        </div>
      </section>

      {/* About */}
      <section className="py-12 px-4 text-center">
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          Flaim is a solo indie project — built with care, maintained for the long term.
          The focus is on reliability and doing one thing well.
        </p>
      </section>

      {/* Footer CTA */}
      <section className="py-16 bg-muted px-4 text-center">
        <h2 className="text-2xl font-bold mb-4">Want to try it?</h2>
        <p className="text-muted-foreground mb-6">
          Connect your fantasy leagues in a few minutes.
        </p>
        <SignedOut>
          <Link href="/sign-up">
            <Button size="lg">Create Account</Button>
          </Link>
        </SignedOut>
        <SignedIn>
          <Link href="/leagues">
            <Button size="lg">Manage Leagues</Button>
          </Link>
        </SignedIn>
      </section>
    </div>
  );
}
