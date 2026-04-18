export function getShortcutModifierKeyLabel() {
  if (typeof navigator === "undefined") {
    return "⌘";
  }

  const platform = navigator.platform;
  const userAgent = navigator.userAgent;
  const isAppleDevice =
    platform.startsWith("Mac") ||
    platform === "iPhone" ||
    platform === "iPad" ||
    platform === "iPod" ||
    userAgent.includes("Macintosh") ||
    userAgent.includes("iPhone") ||
    userAgent.includes("iPad") ||
    userAgent.includes("iPod");

  return isAppleDevice ? "⌘" : "Ctrl";
}
