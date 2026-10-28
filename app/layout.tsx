import {pageAccount} from "@/lib/accounts/server";
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "SNAPLIST — Fotos zu eBay-Angeboten",
  description:
    "Fotos hochladen, Artikel sortieren und eBay-Angebote kontrolliert vorbereiten.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1d6b5f",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account=await pageAccount();
  return (
    <html lang="de">
      <body data-account={account?.id} data-account-owner={account?.owner ? "true" : undefined}>{children}</body>
    </html>
  );
}
