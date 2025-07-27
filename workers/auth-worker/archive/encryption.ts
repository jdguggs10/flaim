/**
 * AES-GCM encryption utilities using WebCrypto API
 * Follows Cloudflare Workers security best practices
 */

export interface EncryptedData {
  ciphertext: string; // base64-encoded
  iv: string; // base64-encoded initialization vector
  keyId?: string; // for future key rotation support
  tag?: string; // base64-encoded auth tag (included in ciphertext for AES-GCM)
}

export class CredentialEncryption {
  private key: CryptoKey | null = null;
  private currentKeyId: string = 'default-key-v1'; // TODO: Make configurable for rotation

  /**
   * Initialize encryption key from environment variable
   */
  async initialize(encryptionKey: string): Promise<void> {
    if (this.key) return; // Already initialized

    // Derive key from the base64-encoded secret
    const keyData = new TextEncoder().encode(encryptionKey);
    
    // Use PBKDF2 to derive a proper AES key
    const importedKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // Derive AES-GCM key
    this.key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new TextEncoder().encode('baseball-espn-mcp-salt'), // Static salt for deterministic key
        iterations: 10000,
        hash: 'SHA-256'
      },
      importedKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt sensitive data using AES-GCM
   */
  async encrypt(data: any): Promise<EncryptedData> {
    if (!this.key) {
      throw new Error('Encryption key not initialized');
    }

    // Generate random IV (96 bits for AES-GCM)
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Convert data to string and encode
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    
    // Encrypt with AES-GCM
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      this.key,
      plaintext
    );

    return {
      ciphertext: this.arrayBufferToBase64(ciphertext),
      iv: this.arrayBufferToBase64(iv.buffer),
      keyId: this.currentKeyId ?? 'default'
    };
  }

  /**
   * Decrypt sensitive data using AES-GCM
   */
  async decrypt(encryptedData: EncryptedData): Promise<any> {
    if (!this.key) {
      throw new Error('Encryption key not initialized');
    }

    const ciphertext = this.base64ToArrayBuffer(encryptedData.ciphertext);
    const iv = this.base64ToArrayBuffer(encryptedData.iv);

    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        this.key,
        ciphertext
      );

      const plaintext = new TextDecoder().decode(decrypted);
      return JSON.parse(plaintext);
    } catch (error) {
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
  }

  /**
   * Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// Singleton instance for the worker
export const credentialEncryption = new CredentialEncryption();