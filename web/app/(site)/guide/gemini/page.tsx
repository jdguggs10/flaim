import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Gemini Status | Flaim',
  description:
    'Gemini is not a live Flaim setup path yet. This page explains the current status and where to use Flaim today instead.',
  alternates: {
    canonical: 'https://flaim.app/guide/gemini',
  },
};

export default function GeminiGuidePage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <h1 className="mb-4 text-3xl font-bold">Gemini status</h1>
        <p className="mb-8 text-muted-foreground">
          Gemini is not a live Flaim setup path today. If you are looking for a current working connector flow, use
          Claude, ChatGPT, or Perplexity instead.
        </p>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What this means right now</h2>
          <ul className="list-disc list-inside space-y-2 text-muted-foreground">
            <li>There is no official Flaim setup flow for Gemini in the app today.</li>
            <li>You do not need to keep hunting through settings for a hidden connector path that does not exist yet.</li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What to use instead</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li><Link href="/guide/claude" className="text-primary hover:underline">Use Flaim with Claude</Link></li>
            <li><Link href="/guide/chatgpt" className="text-primary hover:underline">Use Flaim with ChatGPT</Link></li>
            <li><Link href="/guide/perplexity" className="text-primary hover:underline">Use Flaim with Perplexity</Link></li>
          </ul>
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold">What to watch for later</h2>
          <p className="text-muted-foreground">
            When Gemini support is ready, it should show up in the app flow and the guide overview. Until then, treat
            Claude, ChatGPT, and Perplexity as the real supported paths.
          </p>
        </section>

        <div className="border-t pt-4">
          <Link href="/guide" className="text-sm text-primary hover:underline">
            &larr; Back to guide overview
          </Link>
        </div>
      </div>
    </div>
  );
}
