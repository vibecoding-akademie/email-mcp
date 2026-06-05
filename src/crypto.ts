import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Šifrování údajů schránek (AES-256-GCM).
 * Z libovolného ENCRYPTION_KEY odvodí 32bajtový klíč (SHA-256), takže klíč může
 * být hex, base64 i obyčejné dlouhé heslo. Výstup = base64url(iv | authTag | ciphertext).
 */
export function makeCrypto(secret: string) {
  const key = createHash("sha256").update(secret, "utf8").digest(); // 32 B

  return {
    encrypt(plain: string): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, ct]).toString("base64url");
    },
    decrypt(blob: string): string {
      const buf = Buffer.from(blob, "base64url");
      const iv = buf.subarray(0, 12);
      const tag = buf.subarray(12, 28);
      const ct = buf.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    },
  };
}
