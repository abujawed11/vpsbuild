const crypto = require("crypto");

const ENCRYPTION_VERSION_PREFIX = "v1:";

let warnedKeyFallback = false;

function getKeyMaterial() {
  const explicit = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (explicit && explicit.trim()) return explicit.trim();

  const fallback = process.env.JWT_SECRET;
  if (fallback && fallback.trim()) {
    if (!warnedKeyFallback) {
      warnedKeyFallback = true;
      console.warn(
        "[credentials] CREDENTIALS_ENCRYPTION_KEY is not set; deriving key from JWT_SECRET (set a dedicated key for production)."
      );
    }
    return fallback.trim();
  }

  throw new Error(
    "Missing encryption key: set CREDENTIALS_ENCRYPTION_KEY (recommended) or JWT_SECRET."
  );
}

function getKeyBytes() {
  const material = getKeyMaterial();

  // If it's a 64-char hex string, treat it as a raw 32-byte key.
  if (/^[0-9a-fA-F]{64}$/.test(material)) {
    return Buffer.from(material, "hex");
  }

  // Otherwise derive a 32-byte key from arbitrary material.
  return crypto.createHash("sha256").update(material, "utf8").digest();
}

function encryptSecret(plaintext) {
  if (plaintext == null) return null;
  const text = String(plaintext);
  const key = getKeyBytes();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_VERSION_PREFIX}${iv.toString("base64")}:${ciphertext.toString(
    "base64"
  )}:${tag.toString("base64")}`;
}

function decryptSecret(value) {
  if (value == null) return null;
  const text = String(value);

  // Legacy/plaintext support: treat values without the prefix as plaintext.
  if (!text.startsWith(ENCRYPTION_VERSION_PREFIX)) return text;

  const payload = text.slice(ENCRYPTION_VERSION_PREFIX.length);
  const [ivB64, ciphertextB64, tagB64] = payload.split(":");
  if (!ivB64 || !ciphertextB64 || !tagB64) {
    throw new Error("Invalid encrypted secret format");
  }

  const key = getKeyBytes();
  const iv = Buffer.from(ivB64, "base64");
  const ciphertext = Buffer.from(ciphertextB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
  return plaintext;
}

function redactSecrets(text, secrets) {
  if (!text) return text;
  let output = String(text);
  for (const secret of secrets || []) {
    if (!secret) continue;
    output = output.split(String(secret)).join("****");
  }
  return output;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  redactSecrets,
};

