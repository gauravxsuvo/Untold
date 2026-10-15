import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { AccountSessionProvider } from "@/components/auth/account-session-provider";
import { InstallPromptProvider } from "@/components/pwa/install-prompt-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Untold — Some things are just between us.",
  description:
    "Untold is a calm home for the conversations that matter. Sign up, add a friend by email, and start talking.",
  applicationName: "Untold",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Untold",
  },
  icons: {
    icon: [
      { url: "/brand/untold-mark.svg", type: "image/svg+xml" },
      { url: "/icons/untold-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f6f2",
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
