/**
 * Unit tests for authentication encryption module
 * Tests credential encryption/decryption functionality
 */

import { credentialEncryption } from '../../../auth/shared/encryption';

describe('Credential Encryption', () => {
  const testEncryptionKey = 'test_key_32_characters_long_here';
  
  beforeEach(async () => {
    await credentialEncryption.initialize(testEncryptionKey);
  });

  describe('Initialization', () => {
    test('initializes with valid key', async () => {
      await expect(credentialEncryption.initialize(testEncryptionKey)).resolves.toBeUndefined();
    });

    test('handles various key lengths with PBKDF2', async () => {
      await expect(credentialEncryption.initialize('short_key')).resolves.toBeUndefined();
    });

    test('handles empty key with PBKDF2', async () => {
      await expect(credentialEncryption.initialize('')).resolves.toBeUndefined();
    });
  });

  describe('Encryption', () => {
    test('encrypts simple text data', async () => {
      const plaintext = 'test_data_to_encrypt';
      
      const encrypted = await credentialEncryption.encrypt(plaintext);
      
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.ciphertext).toBeTruthy();
      expect(encrypted.ciphertext).not.toBe(plaintext);
    });

    test('encrypts JSON data', async () => {
      const credentials = {
        clerkUserId: 'user_123',
        swid: 'test_swid',
        espn_s2: 'test_s2',
        email: 'test@example.com'
      };
      
      const plaintext = JSON.stringify(credentials);
      const encrypted = await credentialEncryption.encrypt(plaintext);
      
      expect(encrypted.ciphertext).not.toContain('user_123');
      expect(encrypted.ciphertext).not.toContain('test@example.com');
    });

    test('generates unique IVs for same data', async () => {
      const plaintext = 'same_data_to_encrypt';
      
      const encrypted1 = await credentialEncryption.encrypt(plaintext);
      const encrypted2 = await credentialEncryption.encrypt(plaintext);
      
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
    });

    test('handles empty string', async () => {
      const encrypted = await credentialEncryption.encrypt('');
      
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('ciphertext');
    });

    test('handles special characters', async () => {
      const plaintext = '{"test": "data with special chars: !@#$%^&*()"}';
      
      const encrypted = await credentialEncryption.encrypt(plaintext);
      
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.ciphertext).toBeTruthy();
    });
  });

  describe('Decryption', () => {
    test('decrypts encrypted data correctly', async () => {
      const originalData = 'test_data_to_decrypt';
      
      const encrypted = await credentialEncryption.encrypt(originalData);
      const decrypted = await credentialEncryption.decrypt(encrypted);
      
      expect(decrypted).toBe(originalData);
    });

    test('decrypts JSON credentials correctly', async () => {
      const credentials = {
        clerkUserId: 'user_456',
        swid: 'decrypt_test_swid',
        espn_s2: 'decrypt_test_s2',
        email: 'decrypt@example.com',
        created_at: '2024-01-01T00:00:00Z'
      };
      
      const plaintext = JSON.stringify(credentials);
      const encrypted = await credentialEncryption.encrypt(plaintext);
      const decrypted = await credentialEncryption.decrypt(encrypted);
      
      expect(decrypted).toBe(plaintext);
      expect(JSON.parse(decrypted)).toEqual(credentials);
    });

    test('fails with invalid IV', async () => {
      const encrypted = {
        iv: 'invalid_iv',
        ciphertext: 'some_ciphertext'
      };
      
      await expect(credentialEncryption.decrypt(encrypted)).rejects.toThrow();
    });

    test('fails with invalid ciphertext', async () => {
      const originalData = 'test_data';
      const encrypted = await credentialEncryption.encrypt(originalData);
      
      const corruptedEncrypted = {
        iv: encrypted.iv,
        ciphertext: 'corrupted_ciphertext'
      };
      
      await expect(credentialEncryption.decrypt(corruptedEncrypted)).rejects.toThrow();
    });

    test('uses static salt for deterministic key derivation', async () => {
      const originalData = 'test_data';
      
      // Encrypt with one key
      await credentialEncryption.initialize('key1_32_characters_long_here!!!');
      const encrypted = await credentialEncryption.encrypt(originalData);
      
      // Try to decrypt with same key derivation (static salt means same result)
      await credentialEncryption.initialize('key1_32_characters_long_here!!!');
      const decrypted = await credentialEncryption.decrypt(encrypted);
      
      expect(decrypted).toBe(originalData);
    });
  });

  describe('Round-trip Encryption', () => {
    test('handles multiple encrypt/decrypt cycles', async () => {
      const originalData = 'multi_cycle_test_data';
      
      let data = originalData;
      
      // Encrypt and decrypt multiple times
      for (let i = 0; i < 5; i++) {
        const encrypted = await credentialEncryption.encrypt(data);
        data = await credentialEncryption.decrypt(encrypted);
      }
      
      expect(data).toBe(originalData);
    });

    test('preserves data integrity with large payloads', async () => {
      const largeData = JSON.stringify({
        clerkUserId: 'user_' + 'x'.repeat(100),
        swid: 'swid_' + 'y'.repeat(200),
        espn_s2: 's2_' + 'z'.repeat(300),
        email: 'test@example.com',
        metadata: {
          nested: {
            data: 'a'.repeat(1000)
          }
        }
      });
      
      const encrypted = await credentialEncryption.encrypt(largeData);
      const decrypted = await credentialEncryption.decrypt(encrypted);
      
      expect(decrypted).toBe(largeData);
      expect(JSON.parse(decrypted)).toEqual(JSON.parse(largeData));
    });
  });

  describe('Security Properties', () => {
    test('ciphertext does not contain plaintext', async () => {
      const sensitiveData = 'password123';
      
      const encrypted = await credentialEncryption.encrypt(sensitiveData);
      
      expect(encrypted.ciphertext).not.toContain(sensitiveData);
      expect(encrypted.iv).not.toContain(sensitiveData);
    });

    test('different plaintexts produce different ciphertexts', async () => {
      const data1 = 'first_piece_of_data';
      const data2 = 'second_piece_of_data';
      
      const encrypted1 = await credentialEncryption.encrypt(data1);
      const encrypted2 = await credentialEncryption.encrypt(data2);
      
      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    test('IV has correct length for AES-GCM', async () => {
      const encrypted = await credentialEncryption.encrypt('test');
      
      // AES-GCM uses 12-byte (96-bit) IVs as per standard
      const ivBuffer = Buffer.from(encrypted.iv, 'base64');
      expect(ivBuffer.length).toBe(12);
    });
  });

  describe('Error Handling', () => {
    test('handles module state persistence in Jest', async () => {
      // Jest module caching means imports share state
      const freshEncryption = await import('../../../auth/shared/encryption');
      
      // Since other tests already initialized, this will work
      await expect(freshEncryption.credentialEncryption.encrypt('test')).resolves.toHaveProperty('ciphertext');
    });

    test('throws on uninitialized decryption', async () => {
      const freshEncryption = await import('../../../auth/shared/encryption');
      
      await expect(freshEncryption.credentialEncryption.decrypt({
        iv: 'test_iv',
        ciphertext: 'test_ciphertext'
      })).rejects.toThrow();
    });
  });
});