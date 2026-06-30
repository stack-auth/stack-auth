import LayoutClient from "./layout-client";
import "./globals.css";

// internal-tool is not adopting Cache Components. Its pages are entirely client-rendered
// and read Hexclave config that is injected at container startup via the sentinel-replacement
// model (built with REPLACE_ME placeholders). Next.js 16.3 prerenders "use client" pages at
// build time (16.2.x did not), which constructs StackClientApp with the unreplaced placeholders
// and fails validation. Opt the whole app out of build-time prerendering so the client app is
// only constructed at request time, after the real values are in place.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <title>Hexclave — MCP Review Tool</title>
      </head>
      <body>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  );
}
