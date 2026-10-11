/** Discord incoming webhooks — the URL itself is the secret, stored encrypted. */
export async function postDiscord(webhookUrl: string, content: string) {
  const u = new URL(webhookUrl);
  if (u.protocol !== "https:" || !/(^|\.)discord(app)?\.com$/.test(u.hostname)) throw new Error("Not a Discord webhook URL.");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord webhook: ${res.status}`);
}
