/**
 * JWT Key Rotation - Following Cloudflare API Shield guidance
 * Rotates signing keys quarterly and maintains key history
 */

export interface KeyMetadata {
  id: string;
  created: string;
  rotated?: string;
  status: 'active' | 'retired' | 'deprecated';
}

export class JWTKeyRotation {
  private static readonly ROTATION_INTERVAL = 90 * 24 * 60 * 60 * 1000; // 90 days
  private static readonly GRACE_PERIOD = 24 * 60 * 60 * 1000; // 24 hours

  constructor(private env: { JWT_KEYS_KV: KVNamespace }) {}

  /**
   * Check if current key needs rotation (quarterly)
   */
  async shouldRotateKey(): Promise<boolean> {
    const rotationLog = await this.getRotationLog();
    if (!rotationLog.length) {
      return true; // First time setup
    }

    const lastRotation = rotationLog[rotationLog.length - 1];
    const lastRotationTime = new Date(lastRotation.created).getTime();
    const now = Date.now();

    return (now - lastRotationTime) > JWTKeyRotation.ROTATION_INTERVAL;
  }

  /**
   * Generate a new key and update rotation log
   */
  async rotateKey(): Promise<{ newSecret: string; keyId: string }> {
    const keyId = this.generateKeyId();
    const newSecret = this.generateSecureKey();
    
    // Update rotation log
    const rotationLog = await this.getRotationLog();
    
    // Mark previous key as retired
    if (rotationLog.length > 0) {
      rotationLog[rotationLog.length - 1].status = 'retired';
      rotationLog[rotationLog.length - 1].rotated = new Date().toISOString();
    }

    // Add new key
    rotationLog.push({
      id: keyId,
      created: new Date().toISOString(),
      status: 'active'
    });

    // Keep only last 4 keys (1 year history)
    if (rotationLog.length > 4) {
      rotationLog.splice(0, rotationLog.length - 4);
    }

    // Atomically update both the active key and rotation log
    await Promise.all([
      this.env.JWT_KEYS_KV.put('active_key', JSON.stringify({
        id: keyId,
        secret: newSecret,
        created: new Date().toISOString()
      })),
      this.saveRotationLog(rotationLog)
    ]);

    return { newSecret, keyId };
  }

  /**
   * Get key rotation history from KV storage
   */
  private async getRotationLog(): Promise<KeyMetadata[]> {
    try {
      const log = await this.env.JWT_KEYS_KV.get('rotation_log');
      return log ? JSON.parse(log) : [];
    } catch (error) {
      console.warn('Failed to parse key rotation log:', error);
      return [];
    }
  }

  /**
   * Save rotation log to KV storage
   */
  private async saveRotationLog(log: KeyMetadata[]): Promise<void> {
    await this.env.JWT_KEYS_KV.put('rotation_log', JSON.stringify(log));
    console.log('Key rotation log updated:', log);
  }

  /**
   * Get current active JWT key from KV
   */
  async getCurrentJWTKey(): Promise<{ id: string; secret: string } | null> {
    try {
      const activeKey = await this.env.JWT_KEYS_KV.get('active_key');
      return activeKey ? JSON.parse(activeKey) : null;
    } catch (error) {
      console.error('Failed to get current JWT key:', error);
      return null;
    }
  }

  /**
   * Generate cryptographically secure key ID
   */
  private generateKeyId(): string {
    const timestamp = Date.now().toString(36);
    const randomBytes = crypto.getRandomValues(new Uint8Array(6));
    const randomString = Array.from(randomBytes)
      .map(b => b.toString(36))
      .join('');
    return `key_${timestamp}_${randomString}`;
  }

  /**
   * Generate 256-bit cryptographically secure key
   */
  private generateSecureKey(): string {
    const keyBytes = crypto.getRandomValues(new Uint8Array(32)); // 256 bits
    return Array.from(keyBytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Get current active key metadata
   */
  async getCurrentKeyMetadata(): Promise<KeyMetadata | null> {
    const rotationLog = await this.getRotationLog();
    return rotationLog.find(key => key.status === 'active') || null;
  }

  /**
   * Check if a key is still valid for verification (enforces grace period)
   */
  async isKeyValid(keyId: string): Promise<boolean> {
    const rotationLog = await this.getRotationLog();
    const key = rotationLog.find(k => k.id === keyId);
    
    if (!key) return false;
    
    // Allow retired keys for grace period
    if (key.status === 'retired' && key.rotated) {
      const rotatedTime = new Date(key.rotated).getTime();
      return (Date.now() - rotatedTime) < JWTKeyRotation.GRACE_PERIOD;
    }
    
    return key.status === 'active';
  }

  /**
   * Get valid keys for JWKS (active + grace period keys)
   */
  async getValidKeysForJWKS(): Promise<KeyMetadata[]> {
    const rotationLog = await this.getRotationLog();
    const now = Date.now();
    
    return rotationLog.filter(key => {
      if (key.status === 'active') return true;
      
      if (key.status === 'retired' && key.rotated) {
        const rotatedTime = new Date(key.rotated).getTime();
        return (now - rotatedTime) < JWTKeyRotation.GRACE_PERIOD;
      }
      
      return false;
    });
  }
}