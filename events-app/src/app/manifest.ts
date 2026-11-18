import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/config";

// Lets people add the site to their phone's home screen, and (on Android) share a post straight into it (S-085, S-086).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME, short_name: APP_NAME, description: "Events near you for the African diaspora.",
    start_url: "/", scope: "/", display: "standalone", background_color: "#1C1020", theme_color: "#1C1020",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
    shortcuts: [{ name: "Share an event", url: "/share" }],
  };
}
