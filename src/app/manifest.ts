import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Khira",
    short_name: "Khira",
    description: "Issue tracking for small teams",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f7f9",
    theme_color: "#2e7d4f",
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "My work", url: "/" },
      { name: "Notifications", url: "/inbox" },
    ],
  };
}
