import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with Flaim — read-only fantasy league analysis for ESPN, Yahoo, and Sleeper",
  alternates: {
    canonical: "https://flaim.app/support",
  },
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-2">Support</h1>
        <p className="text-muted-foreground mb-8">
          Flaim is built and maintained by one person. If something is broken
          or confusing, tell me and I will fix it.
        </p>

        <div className="max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold mb-3">Get in Touch</h2>
            <p className="text-muted-foreground">
              Email{" "}
              <a
                href="mailto:support@flaim.app"
                className="underline hover:text-foreground"
              >
                support@flaim.app
              </a>{" "}
              or open an issue on{" "}
              <a
                href="https://github.com/jdguggs10/flaim/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-foreground"
              >
                GitHub
              </a>
              . Include which platform you use (ESPN, Yahoo, or Sleeper) and
              what you were trying to do. Screenshots help.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Quick Fixes</h2>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
              <li>
                ESPN data looks stale or errors out: re-sync your session with
                the Flaim Chrome extension, then try again.
              </li>
              <li>
                A league is missing: open{" "}
                <Link href="/leagues" className="underline hover:text-foreground">
                  your leagues page
                </Link>{" "}
                and check that the league appears there.
              </li>
              <li>
                Your AI assistant cannot reach Flaim: disconnect the Flaim app
                in the assistant, reconnect, and approve access again.
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
