const crypto = require('crypto');
const { encryptSecret, decryptSecret, getEncryptionKey } = require('../../src/utils/crypto');

describe('Crypto Utility (AES-256-GCM)', () => {
  const originalEnv = process.env.ENCRYPTION_KEY;
  const validKey = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = validKey;
  });

  afterAll(() => {
    process.env.ENCRYPTION_KEY = originalEnv;
  });

  describe('encryptSecret and decryptSecret round-trip', () => {
    it('should successfully encrypt and decrypt a plaintext secret', () => {
      const plaintext = 'azure-client-secret-super-secure-token-98765';
      const encrypted = encryptSecret(plaintext);

      expect(encrypted).toHaveProperty('ciphertext');
      expect(encrypted).toHaveProperty('iv');
      expect(encrypted).toHaveProperty('authTag');
      expect(typeof encrypted.ciphertext).toBe('string');
      expect(typeof encrypted.iv).toBe('string');
      expect(typeof encrypted.authTag).toBe('string');

      const decrypted = decryptSecret(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should generate unique IV and different ciphertexts for identical plaintext inputs', () => {
      const plaintext = 'identical-secret';
      const enc1 = encryptSecret(plaintext);
      const enc2 = encryptSecret(plaintext);

      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(decryptSecret(enc1)).toBe(plaintext);
      expect(decryptSecret(enc2)).toBe(plaintext);
    });

    it('should throw an error when plaintext is missing or not a non-empty string', () => {
      expect(() => encryptSecret('')).toThrow('Encryption failed: Plaintext secret must be a non-empty string.');
      expect(() => encryptSecret(null)).toThrow('Encryption failed: Plaintext secret must be a non-empty string.');
      expect(() => encryptSecret(undefined)).toThrow('Encryption failed: Plaintext secret must be a non-empty string.');
    });

    it('should throw an error when decryptSecret receives missing payload fields', () => {
      expect(() => decryptSecret({})).toThrow('Decryption failed: Missing required payload fields');
      expect(() => decryptSecret({ ciphertext: 'abc', iv: 'def' })).toThrow('Decryption failed: Missing required payload fields');
    });
  });

  describe('Invalid Key Handling', () => {
    it('should throw fatal error when ENCRYPTION_KEY is missing', () => {
      delete process.env.ENCRYPTION_KEY;
      expect(() => getEncryptionKey()).toThrow(
        'FATAL CONFIGURATION ERROR: ENCRYPTION_KEY environment variable is missing.'
      );
    });

    it('should throw fatal error when ENCRYPTION_KEY is not 64 hex characters', () => {
      process.env.ENCRYPTION_KEY = 'shortkey123';
      expect(() => getEncryptionKey()).toThrow(
        'FATAL CONFIGURATION ERROR: ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).'
      );

      process.env.ENCRYPTION_KEY = 'z'.repeat(64); // invalid hex characters
      expect(() => getEncryptionKey()).toThrow(
        'FATAL CONFIGURATION ERROR: ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).'
      );
    });
  });

  describe('Authentication Tag & Tampering Failure', () => {
    it('should throw an error when ciphertext is tampered with', () => {
      const encrypted = encryptSecret('confidential-azure-credential');

      // Tamper with the last character of ciphertext
      const lastChar = encrypted.ciphertext.slice(-1);
      const tamperedChar = lastChar === 'a' ? 'b' : 'a';
      const tamperedPayload = {
        ...encrypted,
        ciphertext: encrypted.ciphertext.slice(0, -1) + tamperedChar
      };

      expect(() => decryptSecret(tamperedPayload)).toThrow();
    });

    it('should throw an error when authTag is tampered with', () => {
      const encrypted = encryptSecret('confidential-azure-credential');

      // Tamper with the authTag
      const lastChar = encrypted.authTag.slice(-1);
      const tamperedChar = lastChar === 'a' ? 'b' : 'a';
      const tamperedPayload = {
        ...encrypted,
        authTag: encrypted.authTag.slice(0, -1) + tamperedChar
      };

      expect(() => decryptSecret(tamperedPayload)).toThrow();
    });

    it('should throw an error when IV is tampered with', () => {
      const encrypted = encryptSecret('confidential-azure-credential');

      // Tamper with the IV
      const lastChar = encrypted.iv.slice(-1);
      const tamperedChar = lastChar === 'a' ? 'b' : 'a';
      const tamperedPayload = {
        ...encrypted,
        iv: encrypted.iv.slice(0, -1) + tamperedChar
      };

      expect(() => decryptSecret(tamperedPayload)).toThrow();
    });
  });
});
