const { StackProvider, StackTheme } = require("@hexclave/next");
const { hexclaveServerApp } = require("../hexclave");
require("./globals.css");


function RootLayout({
  children,
}: any) {
  return (
    <html lang="en">
      <body><StackProvider app={hexclaveServerApp}><StackTheme>{children}</StackTheme></StackProvider></body>
    </html>
  );
}

module.exports = RootLayout;
