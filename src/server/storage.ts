import "server-only";
import { AwsClient } from "aws4fetch";
import { mkdir, stat, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const ALLOWED_MIME = [
  /^image\/(png|jpeg|gif|webp|avif)$/,
  /^application\/pdf$/,
  /^text\/(plain|csv|markdown)$/,
  /^application\/(zip|json|x-zip-compressed)$/,
  /^application\/vnd\.openxmlformats-officedocument\./,
  /^video\/(mp4|webm|quicktime)$/,
];
export const mimeAllowed = (m: string) => ALLOWED_MIME.some((r) => r.test(m));
/** Images render inline; everything else downloads, so nothing user-supplied runs in our origin. */
export const inlineSafe = (m: string) => /^image\/(png|jpeg|gif|webp|avif)$/.test(m);

const s3 =
  process.env.S3_ENDPOINT && process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? {
        client: new AwsClient({ accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY, service: "s3", region: process.env.S3_REGION ?? "auto" }),
        base: `${process.env.S3_ENDPOINT.replace(/\/$/, "")}/${process.env.S3_BUCKET}`,
      }
    : null;

const LOCAL_DIR = path.resolve(process.env.LOCAL_UPLOAD_DIR ?? ".uploads");
const localPath = (key: string) => {
  const p = path.resolve(LOCAL_DIR, key);
  if (!p.startsWith(LOCAL_DIR + path.sep)) throw new Error("Bad storage key.");
  return p;
};

function assertConfigured() {
  if (!s3 && process.env.NODE_ENV === "production" && !process.env.LOCAL_UPLOAD_DIR)
    throw new Error("File storage is not configured: set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
}

/** URL the browser PUTs the file to. */
export async function uploadUrl(key: string, mime: string) {
  assertConfigured();
  if (!s3) return { url: `/api/files/${key}`, headers: { "Content-Type": mime } };
  const signed = await s3.client.sign(`${s3.base}/${key}?X-Amz-Expires=600`, { method: "PUT", headers: { "Content-Type": mime }, aws: { signQuery: true } });
  return { url: signed.url, headers: { "Content-Type": mime } };
}

/** Short-lived URL to read a file. */
export async function downloadUrl(key: string, name: string, mime: string) {
  if (!s3) return `/api/files/${key}`;
  const disposition = `${inlineSafe(mime) ? "inline" : "attachment"}; filename="${name.replace(/["\\\r\n]/g, "_")}"`;
  const u = `${s3.base}/${key}?X-Amz-Expires=300&response-content-disposition=${encodeURIComponent(disposition)}`;
  return (await s3.client.sign(u, { method: "GET", aws: { signQuery: true } })).url;
}

/** Size of the stored object, or null if the upload never landed. */
export async function storedSize(key: string): Promise<number | null> {
  if (!s3) return stat(localPath(key)).then((s) => s.size, () => null);
  const res = await s3.client.fetch(`${s3.base}/${key}`, { method: "HEAD" });
  return res.ok ? Number(res.headers.get("content-length") ?? 0) : null;
}

export async function writeLocal(key: string, data: Buffer) {
  const p = localPath(key);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, data);
}
export const readLocal = (key: string) => readFile(localPath(key));
export const usingS3 = !!s3;

/** Server-side write (backups). */
export async function putObject(key: string, body: string, mime: string) {
  if (!s3) return writeLocal(key, Buffer.from(body));
  const res = await s3.client.fetch(`${s3.base}/${key}`, { method: "PUT", headers: { "Content-Type": mime }, body });
  if (!res.ok) throw new Error(`Backup upload failed: ${res.status}`);
}
