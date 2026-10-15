import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { AccountSessionProvider } from "@/components/auth/account-session-provider";
import { InstallPromptProvider } from "@/components/pwa/install-prompt-provider";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://untold.portways.app"),
  title: "Untold | Some things are just between us.",
  description:
    "A quiet place for your conversations. Add a friend, share a moment, and keep in touch with Untold.",
  applicationName: "Untold",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "Untold",
    title: "Some things are just between us.",
    description: "A quiet place for your conversations. Add a friend, share a moment, and keep in touch.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Some things are just between us.",
    description: "A quiet place for your conversations. Add a friend, share a moment, and keep in touch.",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Untold",
  },
  icons: {
    icon: [
      { url: "/icons/untold-app-icon.svg?v=2", type: "image/svg+xml" },
      { url: "/icons/untold-192.png?v=2", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png?v=2", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f8f4",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await connection();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AccountSessionProvider>
          <InstallPromptProvider>{children}</InstallPromptProvider>
        </AccountSessionProvider>
      </body>
    </html>
  );
}
