import { Metadata } from 'next';
import { Lock, Shield, User } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Privacy Policy | Flaim',
  description: 'Privacy policy for Flaim — fantasy sports AI connector for ESPN and Yahoo',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: February 16, 2026</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          <section id="your-data" className="not-prose">
            <h2 className="text-2xl font-bold text-center mb-8">How It Handles Your Data</h2>
            <div className="grid sm:grid-cols-3 gap-6">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-background border flex items-center justify-center mx-auto mb-3">
                  <Lock className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Credentials Stay Here</h3>
                <p className="text-sm text-muted-foreground">
                  ESPN and Yahoo credentials are stored securely and never sent to the AI.
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-background border flex items-center justify-center mx-auto mb-3">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Your AI, Your Account</h3>
                <p className="text-sm text-muted-foreground">
                  You use your own Claude or ChatGPT subscription. Flaim just connects the data.
                </p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-background border flex items-center justify-center mx-auto mb-3">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">Solo Project</h3>
                <p className="text-sm text-muted-foreground">
                  Built and maintained by one person. No investors, no growth pressure.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Overview</h2>
            <p className="text-muted-foreground">
              Flaim is a fantasy sports analysis tool that connects your ESPN and Yahoo fantasy
              leagues to AI assistants like ChatGPT and Claude. This privacy policy explains how
              we collect, use, and protect your information when you use Flaim, the Flaim Chrome
              Extension, and the Flaim MCP server.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Information We Collect</h2>

            <h3 className="text-lg font-medium mt-4 mb-2">Account Information</h3>
            <p className="text-muted-foreground">
              When you sign up for Flaim, we collect basic account information through our
              authentication provider (Clerk), including your email address and display name.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-2">ESPN Credentials (Chrome Extension)</h3>
            <p className="text-muted-foreground">
              If you use the Flaim Chrome Extension, we collect your ESPN session credentials
              (SWID and espn_s2) when you explicitly click &quot;Sync to Flaim&quot; in the extension.
              These are session identifiers that allow us to fetch your fantasy league
              data from ESPN on your behalf.
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li><strong>SWID:</strong> A unique identifier for your ESPN account</li>
              <li><strong>espn_s2:</strong> A session token for accessing ESPN&apos;s fantasy APIs</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We do not collect your ESPN username or password. The extension only reads
              session credentials that ESPN has already set in your browser.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-2">Yahoo Credentials (OAuth)</h3>
            <p className="text-muted-foreground">
              If you connect a Yahoo account, we store OAuth refresh tokens issued by Yahoo
              through a standard authorization flow. These tokens allow us to fetch your Yahoo
              fantasy league data on your behalf. We do not collect your Yahoo username or
              password.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">How We Use Your Information</h2>
            <p className="text-muted-foreground">
              We use your platform credentials (ESPN session credentials and Yahoo OAuth tokens) solely to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Fetch your fantasy league rosters, scores, and standings</li>
              <li>Provide analysis and recommendations for your fantasy teams</li>
              <li>Display your league information within the Flaim application</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We do not use your credentials for any other purpose.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data Transmission and Storage</h2>

            <h3 className="text-lg font-medium mt-4 mb-2">Transmission</h3>
            <p className="text-muted-foreground">
              All data is transmitted over HTTPS (TLS 1.2+), ensuring encryption in transit.
              The Chrome extension communicates exclusively with flaim.app over secure connections.
            </p>

            <h3 className="text-lg font-medium mt-4 mb-2">Storage</h3>
            <p className="text-muted-foreground">
              Your platform credentials are stored in our database (Supabase) with the following
              security measures:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li><strong>Encryption at rest:</strong> AES-256 encryption for all stored data</li>
              <li><strong>Row-level security:</strong> Each user can only access their own data</li>
              <li><strong>Access controls:</strong> Database access is restricted to authenticated API calls</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Data Retention</h2>
            <p className="text-muted-foreground">
              We retain your platform credentials only as long as needed to provide the service:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>
                <strong>ESPN credentials:</strong> Retained until you disconnect, or automatically
                invalidated when ESPN expires them (typically ~30 days).
              </li>
              <li>
                <strong>Yahoo tokens:</strong> Retained until you disconnect your Yahoo account.
                Tokens auto-refresh; revoking access in Yahoo immediately invalidates them.
              </li>
              <li>
                <strong>Account data:</strong> Retained until you request deletion. Upon deletion,
                all stored credentials and league data are permanently removed within 30 days.
              </li>
              <li>
                <strong>Remove credentials:</strong> Visit{' '}
                <a href="/leagues" className="text-primary hover:underline">flaim.app/leagues</a>
                {' '}to manage or remove your platform credentials.
              </li>
              <li>
                <strong>Delete account:</strong> Contact us at{' '}
                <a href="mailto:privacy@flaim.app" className="text-primary hover:underline">privacy@flaim.app</a>
                {' '}to request complete account deletion.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Third-Party Sharing</h2>
            <p className="text-muted-foreground">
              We do not sell, rent, or share your personal information or platform credentials
              with any third parties. Your data is used exclusively to provide Flaim&apos;s
              services to you. Our service providers (Clerk for authentication, Supabase for
              data storage) process data only as necessary to operate the service.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Your Rights</h2>
            <p className="text-muted-foreground">
              You have the right to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Disconnect the extension at any time and remove stored credentials via <a href="/leagues" className="text-primary hover:underline">flaim.app/leagues</a></li>
              <li>Request a copy of your stored data</li>
              <li>Request deletion of your account and all associated data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Platform Affiliation Disclaimer</h2>
            <p className="text-muted-foreground">
              Flaim is not affiliated with, endorsed by, or sponsored by ESPN, The Walt
              Disney Company, Yahoo, or any of their subsidiaries. ESPN is a trademark of
              ESPN, Inc. Yahoo is a trademark of Yahoo Inc. We access fantasy data with
              your explicit consent using the credentials you provide.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Children&apos;s Privacy</h2>
            <p className="text-muted-foreground">
              Flaim is not directed at children under the age of 13. We do not knowingly
              collect personal information from children under 13. If you believe a child
              under 13 has provided us with personal information, please contact us at{' '}
              <a href="mailto:privacy@flaim.app" className="text-primary hover:underline">privacy@flaim.app</a>
              {' '}and we will promptly delete it.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Legal Compliance</h2>
            <p className="text-muted-foreground">
              If you are a resident of the European Economic Area (EEA), United Kingdom, or
              Switzerland, we process your data on the legal basis of your consent (provided
              when you connect your fantasy platform accounts) and our legitimate interest in
              operating the service. You have the right to access, correct, or delete your
              personal data, and to withdraw consent at any time by disconnecting your accounts.
            </p>
            <p className="text-muted-foreground mt-2">
              If you are a California resident, you have the right under the California Consumer
              Privacy Act (CCPA) to request disclosure of the categories of personal information
              we collect, the purposes for collection, and to request deletion of your data.
              We do not sell personal information. To exercise these rights, contact us at{' '}
              <a href="mailto:privacy@flaim.app" className="text-primary hover:underline">privacy@flaim.app</a>.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Changes to This Policy</h2>
            <p className="text-muted-foreground">
              We may update this privacy policy from time to time. We will notify you of
              any significant changes by posting the new policy on this page and updating
              the &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Contact Us</h2>
            <p className="text-muted-foreground">
              If you have questions about this privacy policy or your data, please contact us at:{' '}
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
