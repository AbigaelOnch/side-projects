import type { Metadata, Viewport } from "next";
import "@fontsource/syne/latin-700.css";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-500.css";
import "@fontsource/dm-sans/latin-600.css";
import "./globals.css";
import { APP_NAME, VERSION } from "@/lib/config";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "Events near you for the African diaspora: networking, career, culture, wellness and more.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1A1210", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="foot">
          <span>{APP_NAME}</span>
          <span data-testid="version">Version {VERSION}</span>
          <span>Times are shown in each event&apos;s local time.</span>
        </footer>
      </body>
    </html>
  );
}
