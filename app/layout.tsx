import type { Metadata, Viewport } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Listing Writer — turn photos into eBay listings",
  description:
    "Upload your item photos and get a ready-to-post eBay listing in seconds.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d6b5f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <nav aria-label="App-Bereiche" className="wrap app-sections">
          <a href="/">Snaplist</a>
          {/* The independent Re-Lister branch registers its route here when merged. */}
          <a href="/live-foto">Live-Foto</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
