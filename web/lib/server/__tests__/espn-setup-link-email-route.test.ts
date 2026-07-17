import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  currentUser: vi.fn(),
  sendEspnSetupLinkEmail: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  currentUser: mocks.currentUser,
}));

vi.mock('@/lib/server/product-email', () => ({
  sendEspnSetupLinkEmail: mocks.sendEspnSetupLinkEmail,
}));

import { POST } from '../../../app/api/espn/setup-link-email/route';

function mockSignedInUser(email: string | null = 'fan@example.com') {
  mocks.currentUser.mockResolvedValue({
    primaryEmailAddress: email ? { emailAddress: email } : null,
    emailAddresses: email ? [{ emailAddress: email }] : [],
  });
}

beforeEach(() => {
  mockSignedInUser();
  mocks.sendEspnSetupLinkEmail.mockResolvedValue({ ok: true, id: 'email_123' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /api/espn/setup-link-email', () => {
  it('rejects unauthenticated requests without sending', async () => {
    mocks.currentUser.mockResolvedValue(null);

    const response = await POST();

    expect(response.status).toBe(401);
    expect(mocks.sendEspnSetupLinkEmail).not.toHaveBeenCalled();
  });

  it('sends the setup link to the signed-in user only', async () => {
    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.sendEspnSetupLinkEmail).toHaveBeenCalledTimes(1);
    const params = mocks.sendEspnSetupLinkEmail.mock.calls[0][0] as {
      to: string;
      leaguesUrl: string;
      extensionUrl: string;
    };
    expect(params.to).toBe('fan@example.com');
    expect(params.leaguesUrl).toBe('https://flaim.app/leagues');
    expect(params.extensionUrl).toContain('chromewebstore.google.com');
  });

  it('returns 400 when the account has no email address', async () => {
    mockSignedInUser(null);

    const response = await POST();

    expect(response.status).toBe(400);
    expect(mocks.sendEspnSetupLinkEmail).not.toHaveBeenCalled();
  });

  it('returns 503 when email sending is disabled', async () => {
    mocks.sendEspnSetupLinkEmail.mockResolvedValue({
      ok: false,
      skipped: true,
      error: 'Product email sending is disabled',
    });

    const response = await POST();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'email_disabled' });
  });

  it('returns 502 when Resend rejects the send', async () => {
    mocks.sendEspnSetupLinkEmail.mockResolvedValue({ ok: false, error: 'boom' });

    const response = await POST();

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'send_failed' });
  });
});
