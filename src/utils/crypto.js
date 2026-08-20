const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV recommended for AES-GCM

/**
 * Validates and retrieves the 32-byte (64 hex characters) ENCRYPTION_KEY from process.env.
 */
function getEncryptionKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || typeof keyHex !== 'string') {
    throw new Error('FATAL CONFIGURATION ERROR: ENCRYPTION_KEY environment variable is missing.');
  }

  const trimmedKey = keyHex.trim();
  if (trimmedKey.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
    throw new Error('FATAL CONFIGURATION ERROR: ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes).');
  }

  return Buffer.from(trimmedKey, 'hex');
}

/**
 * Encrypts a plaintext secret string using AES-256-GCM in memory.
 * Generates a unique 12-byte IV per invocation.
 * Returns { ciphertext, iv, authTag } as hex strings.
 */
function encryptSecret(plaintext) {
  if (!plaintext || typeof plaintext !== 'string') {
    throw new Error('Encryption failed: Plaintext secret must be a non-empty string.');
  }

  const keyBuffer = getEncryptionKey();
  const ivBuffer = crypto.randomBytes(IV_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, ivBuffer);

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  const iv = ivBuffer.toString('hex');

  return {
    ciphertext,
    iv,
    authTag
  };
}

/**
 * Decrypts an AES-256-GCM encrypted payload { ciphertext, iv, authTag }.
 * Validates the authentication tag for tamper protection.
 * Returns the decrypted plaintext secret string.
 */
function decryptSecret({ ciphertext, iv, authTag }) {
  if (!ciphertext || !iv || !authTag) {
    throw new Error('Decryption failed: Missing required payload fields (ciphertext, iv, authTag).');
  }

  const keyBuffer = getEncryptionKey();
  const ivBuffer = Buffer.from(iv, 'hex');
  const authTagBuffer = Buffer.from(authTag, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, ivBuffer);
  decipher.setAuthTag(authTagBuffer);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  return plaintext;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  getEncryptionKey
};
