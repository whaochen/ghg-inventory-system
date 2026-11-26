import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export interface EncryptedEnvelope {
  version: 1;
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  salt_hex: string;
  iv_hex: string;
  auth_tag_hex: string;
  ciphertext_b64: string;
  created_at: string;
}

export class DecryptionError extends Error {
  constructor(message = '解密失敗：密碼錯誤或備份檔案已損毀') {
    super(message);
    this.name = 'DecryptionError';
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (!passphrase || passphrase.length < 4) {
    throw new Error('加密密碼長度至少須 4 個字元');
  }
  return scryptSync(passphrase, salt, 32);
}

/**
 * 將任意 JSON 資料以 AES-256-GCM 加密為可攜式備份封包
 */
export function encryptPayload<T>(payload: T, passphrase: string): EncryptedEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = deriveKey(passphrase, salt);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt_hex: salt.toString('hex'),
    iv_hex: iv.toString('hex'),
    auth_tag_hex: authTag.toString('hex'),
    ciphertext_b64: encrypted.toString('base64'),
    created_at: new Date().toISOString(),
  };
}

/**
 * 解密 AES-256-GCM 封包並還原 JSON 資料
 */
export function decryptPayload<T>(envelope: EncryptedEnvelope, passphrase: string): T {
  if (envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') {
    throw new DecryptionError('不支援的加密備份格式版本');
  }

  try {
    const salt = Buffer.from(envelope.salt_hex, 'hex');
    const iv = Buffer.from(envelope.iv_hex, 'hex');
    const authTag = Buffer.from(envelope.auth_tag_hex, 'hex');
    const ciphertext = Buffer.from(envelope.ciphertext_b64, 'base64');
    const key = deriveKey(passphrase, salt);

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as T;
  } catch {
    throw new DecryptionError();
  }
}

/**
 * 本機加密儲存庫（用於寫入與讀取 client_data 或備份檔 .backup.enc）
 */
export class EncryptedFileStore<T> {
  constructor(private readonly filePath: string) {}

  save(data: T, passphrase: string): EncryptedEnvelope {
    const envelope = encryptPayload(data, passphrase);
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(envelope, null, 2), 'utf8');
    return envelope;
  }

  load(passphrase: string): T | null {
    if (!existsSync(this.filePath)) {
      return null;
    }
    const raw = readFileSync(this.filePath, 'utf8');
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    return decryptPayload<T>(envelope, passphrase);
  }
}
