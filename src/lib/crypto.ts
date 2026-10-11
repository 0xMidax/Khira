import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** ENCRYPTION_KEY: 32 bytes, base64 (`openssl rand -base64 32`). Falls back to a key derived from BETTER_AUTH_SECRET. */
function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
    return k;
  }
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Set ENCRYPTION_KEY (or BETTER_AUTH_SECRET) to store integration secrets.");
  return createHash("sha256").update(`khira-enc:${secret}`).digest();
}

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv, c.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decrypt(box: string) {
  const [v, iv, tag, data] = box.split(".");
  if (v !== "v1") throw new Error("Unknown ciphertext version.");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const hmacHex = (secret: string, payload: string, algo: "sha256" | "sha1" = "sha256") => createHmac(algo, secret).update(payload).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomToken = (bytes = 24) => randomBytes(bytes).toString("base64url");
