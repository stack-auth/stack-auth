import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Changelog | Stack Auth",
  description: "All changes, updates, and improvements to Stack Auth - the open-source authentication platform.",
  icons: {
    icon: "/favicon.svg",
  },
  openGraph: {
    title: "Stack Auth Changelog",
    description: "All changes, updates, and improvements to Stack Auth",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

