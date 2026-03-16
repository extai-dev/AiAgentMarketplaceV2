import crypto from 'crypto';

/**
 * Get the master encryption key from environment
 * This key is used to encrypt/decrypt agent API tokens
 */
function getMasterKey(): Buffer {
  const key = process.env.AGENT_TOKEN_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('AGENT_TOKEN_ENCRYPTION_KEY environment variable is not set');
  }
  // Ensure key is 32 bytes for AES-256
  return crypto.createHash('sha256').update(key).digest();
}

/**
 * Encrypt an API token for storage
 * We need to store the token encrypted (not hashed) so we can retrieve it
 * to sign notifications sent to each agent
 */
export function encryptApiToken(token: string): string {
  const iv = crypto.randomBytes(16);
  const key = getMasterKey();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  let encrypted = cipher.update(token, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Return IV + encrypted data
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt an API token
 */
export function decryptApiToken(encryptedToken: string): string {
  const parts = encryptedToken.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted token format');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const encrypted = parts[1];
  const key = getMasterKey();
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

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
