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

  constructor(private env: { JWT_SECRET: string; KEY_ROTATION_LOG?: string }) {}

  /**
   * Check if current key needs rotation (quarterly)
   */
  shouldRotateKey(): boolean {
    const rotationLog = this.getRotationLog();
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
    const rotationLog = this.getRotationLog();
    
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

    this.saveRotationLog(rotationLog);

    return { newSecret, keyId };
  }

  /**
   * Get key rotation history from environment or storage
   */
  private getRotationLog(): KeyMetadata[] {
    try {
      if (this.env.KEY_ROTATION_LOG) {
        return JSON.parse(this.env.KEY_ROTATION_LOG);
      }
    } catch (error) {
      console.warn('Failed to parse key rotation log:', error);
    }
    return [];
  }

  /**
   * Save rotation log (in production, this would update Cloudflare env vars)
   */
  private saveRotationLog(log: KeyMetadata[]): void {
    console.log('Key rotation log updated:', log);
    // In production, you would use Cloudflare API to update environment variables
    // For now, just log the change
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
  getCurrentKeyMetadata(): KeyMetadata | null {
    const rotationLog = this.getRotationLog();
    return rotationLog.find(key => key.status === 'active') || null;
  }

  /**
   * Check if a key is still valid for verification
   */
  isKeyValid(keyId: string): boolean {
    const rotationLog = this.getRotationLog();
    const key = rotationLog.find(k => k.id === keyId);
    
    if (!key) return false;
    
    // Allow retired keys for a grace period (24 hours)
    if (key.status === 'retired' && key.rotated) {
      const rotatedTime = new Date(key.rotated).getTime();
      const gracePeriod = 24 * 60 * 60 * 1000; // 24 hours
      return (Date.now() - rotatedTime) < gracePeriod;
    }
    
    return key.status === 'active';
  }
}