import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

const inspirations = [
  {
    name: 'Plain Text Sports',
    url: 'https://plaintextsports.com',
    description:
      'Sports scores and schedules, stripped down to pure information. No clutter, no noise — just what you need to know. A reminder that simple can be better.',
  },
  {
    name: 'CrazyNinjaOdds',
    url: 'https://crazyninjaodds.com',
    description:
      'A toolkit for sports betting built by one person (CrazyNinjaMike). Calculators, odds comparison, arbitrage detection — all with a casual, self-aware tone. Proof that solo projects can be genuinely useful.',
  },
  {
    name: 'Pikkit',
    url: 'https://pikkit.com',
    description:
      'Bet tracking done right. Syncs with sportsbooks automatically so you don\'t have to manually log everything. Clean execution of a focused idea.',
  },
  {
    name: 'espn-api',
    url: 'https://github.com/cwendt94/espn-api',
    description:
      'A Python library for ESPN Fantasy data by cwendt94. Open source, well-maintained, and a direct inspiration for how Flaim connects to ESPN. Standing on the shoulders of good work.',
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
