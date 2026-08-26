import { NextResponse } from 'next/server';
import { currentUser } from '@clerk/nextjs/server';
import { CHROME_EXTENSION_URL } from '@/config/constants';
import { emailBrand } from '@/emails/brand';
import { withEmailRef } from '@/emails/link-ref';
import { logEmailOps } from '@/lib/server/email-ops';
import { sendEspnSetupLinkEmail } from '@/lib/server/product-email';

// Best-effort per-user cooldown. In-memory, so it only holds within a warm
// serverless instance — enough to stop a retry loop or button hammering from
// turning into repeated Resend sends, without needing shared infrastructure.
const SETUP_LINK_COOLDOWN_MS = 60_000;
const lastSendByUser = new Map<string, number>();

/**
 * POST /api/espn/setup-link-email
 * Sends the ESPN send-to-desktop setup link to the signed-in user's own
 * email address. The recipient is never caller-controlled.
 */
export async function POST() {
  let userId: string | undefined;

  try {
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    userId = user.id;

    const lastSend = lastSendByUser.get(user.id);
    if (lastSend !== undefined && Date.now() - lastSend < SETUP_LINK_COOLDOWN_MS) {
      return NextResponse.json(
        { error: 'rate_limited', error_description: 'Setup link was just sent. Check your inbox.' },
        { status: 429 }
      );
    }

    const email =
      user.primaryEmailAddress?.emailAddress ||
      user.emailAddresses[0]?.emailAddress;
    if (!email) {
      return NextResponse.json(
        { error: 'no_email', error_description: 'No email address on this account' },
        { status: 400 }
      );
    }

    const result = await sendEspnSetupLinkEmail({
      extensionUrl: CHROME_EXTENSION_URL,
      leaguesUrl: withEmailRef(`${emailBrand.url}/leagues`, 'email-espn-setup-link'),
      to: email,
      userId: user.id,
    });

    if (result.skipped) {
      return NextResponse.json(
        { error: 'email_disabled', error_description: 'Email sending is not enabled' },
        { status: 503 }
      );
    }

    if (!result.ok) {
      return NextResponse.json(
        { error: 'send_failed', error_description: 'Could not send the email' },
        { status: 502 }
      );
    }

    lastSendByUser.set(user.id, Date.now());
    return NextResponse.json({ ok: true });
  } catch (error) {
    logEmailOps('email.send_failed', {
      error,
      reason: 'setup_link_route_failed',
      source: 'espn.setup_link_email',
      userId,
    });
    return NextResponse.json(
      { error: 'send_failed', error_description: 'Could not send the email' },
      { status: 500 }
    );
  }
}
