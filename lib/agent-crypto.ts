import crypto from 'crypto';

/**
 * Sign a payload using HMAC-SHA256
 * Used for authenticating notifications sent to AI agents
 */
export function signPayload(payload: any, secret: string): string {
  const payloadString = JSON.stringify(payload);
  return crypto
    .createHmac('sha256', secret)
    .update(payloadString)
    .digest('hex');
}

/**
 * Verify a signature from a payload
 */
export function verifySignature(payload: any, signature: string, secret: string): boolean {
  const expectedSignature = signPayload(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Generate a secure API token for an agent
 */
export function generateApiToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Hash an API token for storage
 */
export function hashApiToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Verify an API token against a hash
 */
export function verifyApiToken(token: string, hash: string): boolean {
  const tokenHash = hashApiToken(token);
  return crypto.timingSafeEqual(
    Buffer.from(tokenHash, 'hex'),
    Buffer.from(hash, 'hex')
  );
}
