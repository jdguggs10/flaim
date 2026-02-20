# Terms of Service Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Publish a production Terms of Service page at `https://flaim.app/terms` and wire it into the footer, sitemap, and submission docs.

**Architecture:** New Next.js page at `web/app/(site)/terms/page.tsx` using the existing site group layout (header + footer auto-included). Mirrors the privacy page structure exactly — no new components or dependencies. Footer, sitemap, and docs updated in the same pass.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS (semantic tokens), Lucide icons (optional).

---

### Task 1: Create the Terms of Service page

**Files:**
- Create: `web/app/(site)/terms/page.tsx`

**Step 1: Create the file**

```tsx
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | Flaim',
  description: 'Terms of Service for Flaim — fantasy sports AI connector for ESPN, Yahoo, and Sleeper',
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
              Flaim is a read-only fantasy sports data connector. It links your ESPN, Yahoo, and Sleeper
              fantasy league data to AI assistants (such as Claude, ChatGPT, and Gemini CLI) via the
              Model Context Protocol (MCP). Flaim fetches data on your behalf and surfaces it to
              the AI tool of your choice — it does not place trades, add or drop players, or modify
              your league in any way.
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
```

**Step 2: Verify file was created correctly**

Open `web/app/(site)/terms/page.tsx` and confirm it has:
- `export const metadata` with `canonical: 'https://flaim.app/terms'`
- 13 `<section>` elements
- No use of the word "cookies" (search for it — should be zero matches)

**Step 3: Commit**

```bash
git add web/app/(site)/terms/page.tsx
git commit -m "feat(web): add Terms of Service page at /terms"
```

---

### Task 2: Add "Terms" link to the site footer

**Files:**
- Modify: `web/app/(site)/layout.tsx`

**Step 1: Read the current footer**

The footer is the inline `<footer>` block at the bottom of `SiteLayout`. It currently has:
```
Built by Gerry · Privacy · Inspirations
```

**Step 2: Add the Terms link**

In `web/app/(site)/layout.tsx`, locate this block:
```tsx
<a href="/privacy" className="underline hover:text-foreground">
  Privacy
</a>
<span aria-hidden="true">·</span>
<a href="/inspirations" className="underline hover:text-foreground">
  Inspirations
</a>
```

Replace with:
```tsx
<a href="/privacy" className="underline hover:text-foreground">
  Privacy
</a>
<span aria-hidden="true">·</span>
<a href="/terms" className="underline hover:text-foreground">
  Terms
</a>
<span aria-hidden="true">·</span>
<a href="/inspirations" className="underline hover:text-foreground">
  Inspirations
</a>
```

**Step 3: Verify**

Footer should now read: `Built by Gerry · Privacy · Terms · Inspirations`

**Step 4: Commit**

```bash
git add web/app/(site)/layout.tsx
git commit -m "feat(web): add Terms link to site footer"
```

---

### Task 3: Add /terms to the sitemap

**Files:**
- Modify: `web/app/sitemap.ts`

**Step 1: Add the /terms entry**

In `web/app/sitemap.ts`, locate the `/privacy` entry:
```ts
{
  url: `${baseUrl}/privacy`,
  lastModified,
  changeFrequency: 'yearly',
  priority: 0.7,
},
```

Add the `/terms` entry immediately after it:
```ts
{
  url: `${baseUrl}/terms`,
  lastModified,
  changeFrequency: 'yearly',
  priority: 0.7,
},
```

**Step 2: Commit**

```bash
git add web/app/sitemap.ts
git commit -m "feat(web): add /terms to sitemap"
```

---

### Task 4: Add Terms link to CONNECTOR-DOCS.md

**Files:**
- Modify: `docs/CONNECTOR-DOCS.md`

**Step 1: Locate the Privacy + Support section**

At the bottom of `docs/CONNECTOR-DOCS.md`:
```markdown
## Privacy + Support

- Privacy policy: `https://flaim.app/privacy`
- Support: `privacy@flaim.app`
```

**Step 2: Add Terms line**

```markdown
## Privacy + Support

- Privacy policy: `https://flaim.app/privacy`
- Terms of service: `https://flaim.app/terms`
- Support: `privacy@flaim.app`
```

**Step 3: Commit**

```bash
git add docs/CONNECTOR-DOCS.md
git commit -m "docs: add Terms of Service link to CONNECTOR-DOCS"
```

---

### Task 5: Update OpenAI submission doc

**Files:**
- Modify: `docs/submissions/openai-app-submission.md`

**Step 1: Check off step 3 in Remaining Steps**

Locate:
```markdown
3. Publish a Terms of Service page at `https://flaim.app/terms` and use that URL in the submission form.
```

Replace with:
```markdown
3. ~~Publish a Terms of Service page at `https://flaim.app/terms` and use that URL in the submission form.~~ **Done** (2026-02-20)
```

**Step 2: Check off the dashboard checklist item**

Locate:
```markdown
- [ ] Terms of Service URL is populated with the production page (`https://flaim.app/terms`).
```

Replace with:
```markdown
- [x] Terms of Service URL is populated with the production page (`https://flaim.app/terms`).
```

**Step 3: Commit**

```bash
git add docs/submissions/openai-app-submission.md
git commit -m "docs: mark Terms of Service as complete in OpenAI submission packet"
```

---

### Task 6: Update CURRENT-EXECUTION-STATE.md

**Files:**
- Modify: `docs/dev/CURRENT-EXECUTION-STATE.md`

**Step 1: Add note to Completed Recently**

Under the "## Completed Recently" section, after item 9 (Submission readiness recheck), add:

```markdown
10. Terms of Service page published (2026-02-20)
- `/terms` page live at `https://flaim.app/terms`.
- Footer, sitemap, and CONNECTOR-DOCS updated with Terms link.
- OpenAI submission packet updated (step 3 and dashboard checklist item checked off).
```

**Step 2: Commit**

```bash
git add docs/dev/CURRENT-EXECUTION-STATE.md
git commit -m "docs: record Terms of Service completion in execution state"
```

---

### Task 7: Local validation

**Step 1: Start the dev server**

```bash
npm run dev:frontend
```

**Step 2: Check /terms renders**

Open `http://localhost:3000/terms`. Verify:
- Page loads without errors
- All 13 sections render with correct headings
- Links (`/privacy`, `mailto:privacy@flaim.app`) are clickable
- No use of "cookies" in the page text (Cmd+F "cookie")

**Step 3: Check footer on any site page**

Open `http://localhost:3000`. Scroll to footer. Verify: `Built by Gerry · Privacy · Terms · Inspirations`

**Step 4: Check /terms link in footer**

Click the "Terms" link in the footer. Verify it navigates to `/terms`.

**Step 5: Check /sitemap.xml**

Open `http://localhost:3000/sitemap.xml`. Verify `/terms` appears.

**Step 6: Check mobile layout**

Resize browser to mobile width (~375px). Verify `/terms` page is readable with no overflow.

---

### Task 8: Push to production

**Step 1: Push main**

```bash
git push origin main
```

**Step 2: Monitor deploy**

```bash
gh run list --limit 3
```

Wait for the Vercel deploy to complete (typically 1-2 minutes).

**Step 3: Verify production**

Open `https://flaim.app/terms` and confirm the page renders correctly.

---

## Legal Placeholders for Human Review

Before the OpenAI submission, confirm these with your own judgment:

| Item | Current wording | Action |
|------|-----------------|--------|
| Liability cap | "to the fullest extent permitted by applicable law" — no dollar amount | Acceptable for solo project; review if desired |
| Indemnification scope | Standard "misuse / ToS violation" framing | Review for comfort |
| Governing law | New York state and federal courts | ✅ User confirmed |
| Effective date | February 20, 2026 | Update if you publish on a different date |
