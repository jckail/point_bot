import "@/styles/globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import { type Metadata } from "next";
import { Inter, Sora } from "next/font/google";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
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
