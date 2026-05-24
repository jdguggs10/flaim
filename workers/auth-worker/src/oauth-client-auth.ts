const CONFIDENTIAL_CLIENT_ID_PREFIX = 'mcp_conf_';
const CLIENT_SECRET_PREFIX = 'mcp_secret_';

export type ClientBoundTokenKind = 'mcp_ac' | 'mcp_rt';

export interface ConfidentialClientRegistration {
  clientId: string;
  clientSecret: string;
}

export function generateSecureToken(length: number = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  const base64 = btoa(String.fromCharCode(...bytes));
  return toBase64Url(base64);
}

export async function createConfidentialClientRegistration(signingKey: string): Promise<ConfidentialClientRegistration> {
  const clientSecret = `${CLIENT_SECRET_PREFIX}${generateSecureToken(32)}`;
  const clientSecretHash = await sha256Base64Url(clientSecret);
  const clientHandle = generateSecureToken(16);
  const signedPayload = `${clientHandle}.${clientSecretHash}`;
  const signature = await hmacSha256Base64Url(signedPayload, signingKey);
  const clientId = `${CONFIDENTIAL_CLIENT_ID_PREFIX}${signedPayload}.${signature}`;

  return { clientId, clientSecret };
}

/**
 * Checks confidential client_id shape only. Use validateConfidentialClientSecret
 * when the caller needs to verify the HMAC signature and matching secret.
 */
export function isConfidentialClientId(clientId?: string): clientId is string {
  return getConfidentialClientIdParts(clientId) !== null;
}

export async function validateConfidentialClientSecret(
  clientId: string | undefined,
  clientSecret: string | undefined,
  signingKey: string
): Promise<boolean> {
  const parts = getConfidentialClientIdParts(clientId);
  if (!parts || !clientSecret) {
    return false;
  }

  const actualHash = await sha256Base64Url(clientSecret);
  const expectedSignature = await hmacSha256Base64Url(parts.signedPayload, signingKey);

  return timingSafeEqual(actualHash, parts.clientSecretHash)
    && timingSafeEqual(expectedSignature, parts.signature);
}

/**
 * Prefixes an opaque auth code or refresh token with a confidential client
 * binding. opaqueValue must be dot-free because "." is the token delimiter.
 */
export function createClientBoundToken(
  kind: ClientBoundTokenKind,
  clientId: string,
  opaqueValue: string
): string {
  if (opaqueValue.includes('.')) {
    throw new Error('Client-bound token opaqueValue must not contain "."');
  }
  return `${kind}.${base64UrlEncodeText(clientId)}.${opaqueValue}`;
}

export function getClientIdFromBoundToken(
  kind: ClientBoundTokenKind,
  token?: string
): string | undefined {
  if (!token) {
    return undefined;
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== kind || !parts[1] || !parts[2]) {
    return undefined;
  }

  const clientId = base64UrlDecodeText(parts[1]);
  if (!clientId || !isConfidentialClientId(clientId)) {
    return undefined;
  }

  return clientId;
}

interface ConfidentialClientIdParts {
  signedPayload: string;
  clientSecretHash: string;
  signature: string;
}

function getConfidentialClientIdParts(clientId?: string): ConfidentialClientIdParts | null {
  if (!clientId?.startsWith(CONFIDENTIAL_CLIENT_ID_PREFIX)) {
    return null;
  }

  const suffix = clientId.slice(CONFIDENTIAL_CLIENT_ID_PREFIX.length);
  const parts = suffix.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [clientHandle, clientSecretHash, signature] = parts;
  if (!/^[A-Za-z0-9_-]{22}$/.test(clientHandle)) {
    return null;
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(clientSecretHash)) {
    return null;
  }

  if (!/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    return null;
  }

  return {
    signedPayload: `${clientHandle}.${clientSecretHash}`,
    clientSecretHash,
    signature,
  };
}

async function sha256Base64Url(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const base64 = btoa(String.fromCharCode(...hashArray));
  return toBase64Url(base64);
}

async function hmacSha256Base64Url(value: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
  const signatureBytes = new Uint8Array(signature);
  const base64 = btoa(String.fromCharCode(...signatureBytes));
  return toBase64Url(base64);
}

function timingSafeEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  // All current callers compare fixed-length base64url SHA-256/HMAC outputs.
  if (actualBytes.length !== expectedBytes.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < actualBytes.length; i++) {
    result |= actualBytes[i] ^ expectedBytes[i];
  }

  return result === 0;
}

function base64UrlEncodeText(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return toBase64Url(btoa(binary));
}

function base64UrlDecodeText(value: string): string | undefined {
  try {
    const padded = fromBase64Url(value);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function toBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64Url(value: string): string {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (base64.length % 4)) % 4;
  return `${base64}${'='.repeat(padding)}`;
}
