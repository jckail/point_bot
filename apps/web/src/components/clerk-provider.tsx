import { ClerkProvider } from "@clerk/nextjs";

/** Branded ClerkProvider. Only loaded (dynamic import) in clerk mode. */
export function BrandedClerkProvider({
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
      {children}
    </ClerkProvider>
  );
}
