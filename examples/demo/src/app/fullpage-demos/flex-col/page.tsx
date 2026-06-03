import { SignIn } from "@hexclave/next";

export default function SimpleDivFullPageDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <SignIn fullPage />
    </div>
  );
}
