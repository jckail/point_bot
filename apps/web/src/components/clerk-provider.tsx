import { ClerkProvider } from "@clerk/nextjs";

/** Branded ClerkProvider. Only loaded (dynamic import) in clerk mode. */
export function BrandedClerkProvider({
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
      {children}
    </ClerkProvider>
  );
}
