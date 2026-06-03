const { StackProvider, StackTheme } = require("@hexclave/next");
const { stackServerApp } = require("../hexclave");
require("./globals.css");


function RootLayout({
  children,
}: any) {
  return (
    <html lang="en">
      <body><StackProvider app={stackServerApp}><StackTheme>{children}</StackTheme></StackProvider></body>
    </html>
  );
}

module.exports = RootLayout;
