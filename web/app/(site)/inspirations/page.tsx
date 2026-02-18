import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  alternates: {
    canonical: 'https://flaim.app/inspirations',
  },
};
import { ExternalLink } from 'lucide-react';

const inspirations = [
  {
    name: 'Plain Text Sports',
    url: 'https://plaintextsports.com',
    description:
      'The greatest sports score application of all time, period.',
  },
  {
    name: 'CrazyNinjaOdds',
    url: 'https://crazyninjaodds.com',
    description:
      'Crazy Ninja Mike is the 🐐.',
  },
  {
    name: 'Pikkit',
    url: 'https://pikkit.com',
    description:
      'Bet tracking done right. The real ones know.',
  },
  {
    name: 'espn-api',
    url: 'https://github.com/cwendt94/espn-api',
    description:
      'Props to cwendt94 for making all this possible.',
  },
];

export default function InspirationsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-16 px-4">
        {/* Intro */}
        <section className="mb-12">
          <h1 className="text-3xl font-bold mb-4">Inspirations</h1>
          <div className="text-muted-foreground space-y-3">
            <p>
              Flaim is a side project — built in spare time, maintained for the long haul.
              The goal is simple: connect fantasy sports data to AI tools, and do it reliably.
            </p>
            <p>
              These are some projects that shaped how I think about building software.
              They share a common thread: focused scope, honest design, and respect for the user.
            </p>
          </div>
        </section>

        {/* Inspirations List */}
        <section className="space-y-8">
          {inspirations.map((item) => (
            <div key={item.name} className="border-b pb-6 last:border-b-0">
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-lg font-semibold hover:text-primary transition-colors"
              >
                {item.name}
                <ExternalLink className="h-4 w-4" />
              </a>
              <p className="text-sm text-muted-foreground mt-2">{item.description}</p>
            </div>
          ))}
        </section>

        {/* Back link */}
        <section className="mt-12 pt-8 border-t">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            ← Back to home
          </Link>
        </section>
      </div>
    </div>
  );
}
