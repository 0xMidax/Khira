import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "transparent" }}>
        <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#2e7d4f", border: "3px solid #e3f1e8" }} />
      </div>
    ),
    size,
  );
}
