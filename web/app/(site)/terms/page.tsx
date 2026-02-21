import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Flaim',
  description: 'Terms of Service for Flaim — read-only fantasy league analysis for ESPN, Yahoo, and Sleeper',
  alternates: {
    canonical: 'https://flaim.app/terms',
  },
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-muted-foreground mb-8">Effective date: February 20, 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">

          <section>
            <h2 className="text-xl font-semibold mb-3">What Flaim Is</h2>
            <p className="text-muted-foreground">
              Flaim is a read-only fantasy analysis service. It retrieves your ESPN, Yahoo, and Sleeper
              fantasy league data and makes it available to AI assistants (such as Claude, ChatGPT, and
              Gemini CLI) via the Model Context Protocol (MCP). Flaim does not place trades, add or drop
              players, or modify your league in any way.
            </p>
            <p className="text-muted-foreground mt-2">
              Flaim is an independent project and is not affiliated with, endorsed by, or sponsored
              by ESPN, The Walt Disney Company, Yahoo Inc., Sleeper, or any of their subsidiaries.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Eligibility</h2>
            <p className="text-muted-foreground">
              You must be at least 13 years old to use Flaim. By creating an account you confirm
              that you meet this requirement. If you are using Flaim on behalf of an organization,
              you confirm you have authority to bind that organization to these terms.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Your Account</h2>
            <p className="text-muted-foreground">
              You are responsible for maintaining the confidentiality of your Flaim account
              credentials and for all activity that occurs under your account. If you believe your
              account has been accessed without authorization, notify us immediately at{' '}
              <a href="mailto:privacy@flaim.app" className="text-primary hover:underline">
                privacy@flaim.app
              </a>
              . We are not liable for losses caused by unauthorized use of your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Platform Credentials</h2>
            <p className="text-muted-foreground">
              To fetch your fantasy data, Flaim stores the following on your behalf:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>
                <strong>ESPN:</strong> Session credentials (SWID and espn_s2) that ESPN issues to
                your browser. These are stored encrypted (AES-256) and used exclusively to read
                your fantasy league data from ESPN&apos;s API. We do not collect your ESPN
                username or password.
              </li>
              <li>
                <strong>Yahoo:</strong> OAuth refresh tokens issued by Yahoo through a standard
                authorization flow. We do not collect your Yahoo username or password.
              </li>
              <li>
                <strong>Sleeper:</strong> Your Sleeper username, used to look up your public
                league data via Sleeper&apos;s public API. No password or token is stored.
              </li>
            </ul>
            <p className="text-muted-foreground mt-2">
              You are responsible for ensuring you are the authorized holder of any credentials
              you provide to Flaim. Credentials are used only to fetch data at your explicit
              request and are never shared with third parties.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Acceptable Use</h2>
            <p className="text-muted-foreground">
              Flaim is a personal, read-only data tool. You agree not to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Use Flaim to scrape, harvest, or mass-collect fantasy data beyond normal personal use</li>
              <li>Share your Flaim account or platform credentials with others</li>
              <li>Abuse the service in ways that degrade performance for other users (e.g., exceeding rate limits programmatically)</li>
              <li>Attempt to reverse-engineer, decompile, or tamper with Flaim&apos;s systems</li>
              <li>Use Flaim for any unlawful purpose or in violation of ESPN&apos;s, Yahoo&apos;s, or Sleeper&apos;s terms of service</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Third-Party Services</h2>
            <p className="text-muted-foreground">
              Flaim depends on third-party services to operate, including ESPN, Yahoo, Sleeper
              (data sources), Clerk (authentication), Supabase (data storage), Cloudflare
              (compute), Vercel (hosting), and your chosen AI provider (Anthropic, OpenAI, Google,
              etc.). Flaim is not responsible for the availability, accuracy, or policy changes of
              these services. Outages or changes to ESPN&apos;s, Yahoo&apos;s, or Sleeper&apos;s
              APIs may affect Flaim&apos;s ability to fetch your data, and Flaim provides no
              guarantee of uninterrupted service as a result.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Disclaimers</h2>
            <p className="text-muted-foreground">
              Flaim is provided &quot;as is&quot; without warranties of any kind, express or
              implied. We do not guarantee that the service will be available at any particular
              time, that fantasy data will be accurate or up to date, or that the service will
              meet your specific needs.
            </p>
            <p className="text-muted-foreground mt-2">
              Fantasy sports decisions — start/sit choices, trades, waiver pickups — are solely
              your responsibility. Flaim surfaces data from your leagues to an AI of your choice,
              but any advice or analysis generated by that AI is not endorsed by Flaim, and Flaim
              is not liable for any outcome of decisions made using Flaim or the AI tools you
              connect to it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Limitation of Liability</h2>
            <p className="text-muted-foreground">
              To the fullest extent permitted by applicable law, Flaim and its operator shall not
              be liable for any indirect, incidental, special, consequential, or punitive damages
              arising out of or related to your use of the service, including but not limited to
              loss of data, fantasy league performance, or profits — even if advised of the
              possibility of such damages. Your sole remedy for dissatisfaction with the service
              is to stop using it and close your account.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Indemnification</h2>
            <p className="text-muted-foreground">
              You agree to indemnify and hold harmless Flaim and its operator from any claims,
              damages, or expenses (including reasonable legal fees) arising from your misuse of
              the service, your violation of these terms, or your violation of any third party&apos;s
              rights.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Termination</h2>
            <p className="text-muted-foreground">
              We may suspend or terminate your access to Flaim at any time if we believe you have
              violated these terms or are using the service in a way that harms other users or
              third parties. You may close your account at any time by contacting us at{' '}
              <a href="mailto:privacy@flaim.app" className="text-primary hover:underline">
                privacy@flaim.app
              </a>
              . Upon closure, stored credentials and league data are removed within 30 days,
              consistent with our{' '}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Changes to These Terms</h2>
            <p className="text-muted-foreground">
              We may update these terms from time to time. When we do, we will update the
              &quot;Effective date&quot; at the top of this page. Continued use of Flaim after
              changes are posted constitutes acceptance of the revised terms. For significant
              changes, we will make reasonable efforts to notify you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Governing Law</h2>
            <p className="text-muted-foreground">
              These terms are governed by the laws of the State of New York, without regard to
              conflict-of-law principles. Any disputes arising from or related to these terms or
              your use of Flaim shall be resolved in the state or federal courts located in
              New York.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact</h2>
            <p className="text-muted-foreground">
              Questions about these terms? Contact us at:{' '}
              <a href="mailto:privacy@flaim.app" className="text-primary hover:underline">
                privacy@flaim.app
              </a>
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
