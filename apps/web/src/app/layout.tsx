import "@/styles/globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import { type Metadata } from "next";
import localFont from "next/font/local";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#7c5cff",
          colorBackground: "#121a30",
          colorForeground: "#f4f6ff",
          colorMutedForeground: "#9aa5cb",
          colorInput: "#0b1020",
          colorInputForeground: "#f4f6ff",
          colorBorder: "rgba(148, 163, 216, 0.14)",
          borderRadius: "0.75rem",
        },
      }}
    >
      <html lang="en" className={`${sora.variable} ${inter.variable}`}>
        <body className="flex min-h-screen flex-col font-sans antialiased">
          <SiteHeader />
          <div className="flex-1">{children}</div>
          <SiteFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}
