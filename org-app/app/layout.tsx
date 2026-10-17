import type { Metadata, Viewport } from "next";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n";
import GestureGuard from "@/components/GestureGuard";
import SessionGuard from "@/components/SessionGuard";

export const metadata: Metadata = {
  title: "FS Org — Flower Solutions",
  description: "Flower Solutions cégirányítási rendszer",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#2f7a4f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <body>
        <GestureGuard />
        <SessionGuard />
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
