import { ImageResponse } from "next/og";

// A green cucumber-slice dot on dark ink, padded for maskable icons.
export async function GET(_: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = (await params).size === "192" ? 192 : 512;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#1c2230" }}>
        <div style={{ width: size * 0.42, height: size * 0.42, borderRadius: "50%", background: "#2e7d4f", border: `${size * 0.05}px solid #e3f1e8` }} />
      </div>
    ),
    { width: size, height: size, headers: { "Cache-Control": "public, max-age=604800, immutable" } },
  );
}
