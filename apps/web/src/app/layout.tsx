import "@/styles/globals.css";

import { type Metadata } from "next";
import localFont from "next/font/local";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { isDevAuth } from "@/server/auth";

// Self-hosted variable fonts (from @fontsource-variable/*) so builds are
// hermetic: no network access to fonts.googleapis.com is needed.
const sora = localFont({
  src: "../fonts/sora-latin-wght-normal.woff2",
  weight: "100 800",
  variable: "--font-sora",
  display: "swap",
});

const inter = localFont({
  src: "../fonts/inter-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "PointUp - all your points, one clear view",
    template: "%s | PointUp",
  },
  description:
    "Track airline miles and hotel points in one place - on the web, on your phone, or right in your browser.",
};

// The auth mode is a runtime setting (AUTH_PROVIDER), so nothing may be
// prerendered at build time with one mode baked in.
export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const page = (
    <html lang="en" className={`${sora.variable} ${inter.variable}`}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <SiteHeader />
        <div className="flex-1">{children}</div>
        <SiteFooter />
      </body>
    </html>
  );
  if (isDevAuth()) return page;
  const { BrandedClerkProvider } = await import("@/components/clerk-provider");
  return <BrandedClerkProvider>{page}</BrandedClerkProvider>;
}
