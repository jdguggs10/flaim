import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Stack | Flaim',
  description:
    'The technologies behind Flaim: MCP, OAuth 2.1, Cloudflare Workers, Hono, Next.js, Vercel, Supabase, Clerk, and TypeScript.',
  alternates: {
    canonical: 'https://flaim.app/stack',
  },
};

const stack = [
  { name: 'MCP', description: 'Model Context Protocol. The open standard that connects Flaim to AI assistants.', url: 'https://modelcontextprotocol.io' },
  { name: 'OAuth 2.1', description: 'Authentication between your AI client and Flaim.', url: 'https://oauth.net/2.1/' },
  { name: 'Cloudflare Workers', description: 'Runs the MCP server and all platform API clients at the edge.', url: 'https://workers.cloudflare.com' },
  { name: 'Hono', description: 'Lightweight web framework powering the Workers.', url: 'https://hono.dev' },
  { name: 'Next.js', description: 'App Router powers the web app.', url: 'https://nextjs.org' },
  { name: 'Vercel', description: 'Hosts and deploys the web app.', url: 'https://vercel.com' },
  { name: 'Supabase', description: 'PostgreSQL database for credentials, leagues, and OAuth tokens.', url: 'https://supabase.com' },
  { name: 'Clerk', description: 'User authentication and session management.', url: 'https://clerk.com' },
  { name: 'TypeScript', description: 'Everything is TypeScript, end to end.', url: 'https://www.typescriptlang.org' },
];

export default function StackPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-4">Stack</h1>
        <p className="text-muted-foreground mb-8">
          The technologies behind Flaim.
        </p>

        <div className="grid gap-3">
          {stack.map(({ name, description, url }) => (
            <a
              key={name}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border bg-background p-4 hover:border-foreground/20 transition-colors"
            >
              <h2 className="font-semibold">{name}</h2>
              <p className="text-sm text-muted-foreground mt-1">{description}</p>
            </a>
          ))}
        </div>

        <div className="pt-8 border-t mt-8">
          <Link href="/" className="text-sm text-primary hover:underline">
            &larr; Back to Flaim
          </Link>
        </div>
      </div>
    </div>
  );
}
