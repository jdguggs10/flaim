import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with Flaim: read-only fantasy league analysis for ESPN, Yahoo, and Sleeper",
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
          <section
            aria-labelledby="yahoo-outage-heading"
            className="rounded-lg border border-warning/40 bg-warning/10 p-4"
          >
            <h2
              id="yahoo-outage-heading"
              className="text-base font-semibold text-foreground"
            >
              Ongoing Yahoo outage
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              <strong className="text-foreground">
                Yahoo league data is temporarily unavailable in Flaim.
              </strong>{" "}
              Yahoo is currently reviewing third-party access to its Fantasy
              Sports API and is blocking unapproved apps across the board, so
              Yahoo sign-in may complete but league data will not load. This is
              not a problem with your account, connection, or league, and no
              reconnect will fix it. Flaim has applied for approval and will
              restore Yahoo automatically once access returns. ESPN and Sleeper
              leagues are unaffected.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Get in Touch</h2>
            <p className="text-muted-foreground">
              Email{" "}
              <a
                href="mailto:support@flaim.app"
                className="underline hover:text-foreground"
              >
                support@flaim.app
              </a>
              {". "}Include which platform you use (ESPN, Yahoo, or Sleeper),
              what you were trying to do, and any screenshots that might help.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Quick Fixes</h2>
            <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
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
