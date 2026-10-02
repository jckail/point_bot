import "@/styles/globals.css";

import { ClerkProvider } from "@clerk/nextjs";
import { type Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.pointup.io"),
  title: {
    default: "PointUp - all your points, one clear view",
    template: "%s | PointUp",
  },
  description:
    "Track loyalty balances, plan trip goals, and compare estimated redemption value in one place.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorPrimary: "#215bcc",
          colorBackground: "#ffffff",
          colorForeground: "#152b46",
          colorMutedForeground: "#4b6077",
          colorInput: "#f3f7fb",
          colorInputForeground: "#152b46",
          colorBorder: "#d4deea",
          borderRadius: "0.75rem",
        },
      }}
    >
      <html lang="en" >
        <body className="flex min-h-screen flex-col font-sans antialiased">
          <a href="#main-content" className="skip-link">Skip to content</a>
          <SiteHeader />
          <div id="main-content" className="flex-1">{children}</div>
          <SiteFooter />
        </body>
      </html>
    </ClerkProvider>
  );
}
