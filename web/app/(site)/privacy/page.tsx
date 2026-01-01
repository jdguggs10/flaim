import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Flaim',
  description: 'Privacy policy for Flaim and the Flaim Chrome Extension',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-3xl mx-auto py-12 px-4">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last updated: December 31, 2025</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-8">
          <section>
            <h2 className="text-xl font-semibold mb-3">Overview</h2>
            <p className="text-muted-foreground">
              Flaim is a fantasy sports analysis tool that helps you make better decisions
              for your ESPN fantasy leagues. This privacy policy explains how we collect,
              use, and protect your information when you use Flaim and the Flaim Chrome Extension.
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
              If you use the Flaim Chrome Extension, we collect your ESPN session cookies
              (SWID and espn_s2) when you explicitly click &quot;Sync to Flaim&quot; in the extension.
              These cookies are session identifiers that allow us to fetch your fantasy league
              data from ESPN on your behalf.
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li><strong>SWID:</strong> A unique identifier for your ESPN account</li>
              <li><strong>espn_s2:</strong> A session token for accessing ESPN&apos;s fantasy APIs</li>
            </ul>
            <p className="text-muted-foreground mt-2">
              We do not collect your ESPN username or password. The extension only reads
              cookies that ESPN has already set in your browser.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">How We Use Your Information</h2>
            <p className="text-muted-foreground">
              We use your ESPN credentials solely to:
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
              Your ESPN credentials are stored in our database (Supabase) with the following
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
              We retain your ESPN credentials until you disconnect the extension or delete
              your account:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>
                <strong>Disconnect extension:</strong> Visit{' '}
                <a href="/extension" className="text-primary hover:underline">flaim.app/extension</a>
                {' '}and click &quot;Disconnect Extension&quot; to revoke access and delete stored credentials.
              </li>
              <li>
                <strong>Delete account:</strong> Contact us to request complete account deletion.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Third-Party Sharing</h2>
            <p className="text-muted-foreground">
              We do not sell, rent, or share your personal information or ESPN credentials
              with any third parties. Your data is used exclusively to provide Flaim&apos;s
              services to you.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">Your Rights</h2>
            <p className="text-muted-foreground">
              You have the right to:
            </p>
            <ul className="list-disc list-inside text-muted-foreground mt-2 space-y-1">
              <li>Disconnect the extension at any time, which immediately revokes our access</li>
              <li>Request a copy of your stored data</li>
              <li>Request deletion of your account and all associated data</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold mb-3">ESPN Affiliation Disclaimer</h2>
            <p className="text-muted-foreground">
              Flaim is not affiliated with, endorsed by, or sponsored by ESPN or The Walt
              Disney Company. ESPN is a trademark of ESPN, Inc. We access ESPN&apos;s fantasy
              data with your explicit consent using the credentials you provide.
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
