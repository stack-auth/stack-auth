import { describe, expect, test } from "vitest";
import { describeUserAgent, formatUserAgentSummary } from "./user-agent";

describe("describeUserAgent", () => {
  test("Chrome on macOS", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toEqual({
      deviceType: "desktop",
      browser: "Chrome 141",
      os: "macOS",
    });
  });

  test("Edge is not reported as Chrome", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.66")).toEqual({
      deviceType: "desktop",
      browser: "Edge 140",
      os: "Windows 10+",
    });
  });

  test("Safari on macOS uses the Version/ token, not the WebKit build", () => {
    expect(describeUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15")).toEqual({
      deviceType: "desktop",
      browser: "Safari 18",
      os: "macOS",
    });
  });

  test("Safari on iPhone", () => {
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1")).toEqual({
      deviceType: "mobile",
      browser: "Safari 17",
      os: "iOS 17.2",
    });
  });

  test("Chrome on iOS reports itself as CriOS", () => {
    expect(describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/115.0.5790.130 Mobile/15E148 Safari/604.1")).toEqual({
      deviceType: "mobile",
      browser: "Chrome 115",
      os: "iOS 16.6",
    });
  });

  test("iPad is a tablet", () => {
    expect(describeUserAgent("Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/604.1")).toEqual({
      deviceType: "tablet",
      browser: "Safari 17",
      os: "iOS 17.2",
    });
  });

  test("Android phone", () => {
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36")).toEqual({
      deviceType: "mobile",
      browser: "Chrome 141",
      os: "Android 14",
    });
  });

  test("Android without the Mobile token is a tablet", () => {
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toEqual({
      deviceType: "tablet",
      browser: "Chrome 141",
      os: "Android 13",
    });
  });

  test("Firefox on Linux", () => {
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0")).toEqual({
      deviceType: "desktop",
      browser: "Firefox 133",
      os: "Linux",
    });
  });

  test("Samsung Internet is not reported as Chrome", () => {
    expect(describeUserAgent("Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36")).toEqual({
      deviceType: "mobile",
      browser: "Samsung Internet 23",
      os: "Android 13",
    });
  });

  test("Internet Explorer 11 hides behind Trident/rv:", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 6.1; Trident/7.0; rv:11.0) like Gecko")).toEqual({
      deviceType: "desktop",
      browser: "Internet Explorer 11",
      os: "Windows 7",
    });
  });

  test("older Internet Explorer uses the MSIE token", () => {
    expect(describeUserAgent("Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)")).toEqual({
      deviceType: "desktop",
      browser: "Internet Explorer 9",
      os: "Windows 7",
    });
  });

  test("unnamed Windows NT versions degrade to a plain Windows", () => {
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 5.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/49.0.0.0 Safari/537.36").os).toBe("Windows");
  });

  test("crawlers are flagged as bots", () => {
    expect(describeUserAgent("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)").deviceType).toBe("bot");
    expect(describeUserAgent("Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36").deviceType).toBe("bot");
  });

  test("headless Chrome keeps its browser label alongside the bot classification", () => {
    expect(describeUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36")).toEqual({
      deviceType: "bot",
      browser: "Chrome 141",
      os: "Linux",
    });
  });

  test("unrecognized user agents degrade to nulls instead of throwing", () => {
    expect(describeUserAgent("some-internal-client/1.0")).toEqual({
      deviceType: "desktop",
      browser: null,
      os: null,
    });
  });
});

describe("formatUserAgentSummary", () => {
  test("joins browser and OS", () => {
    expect(formatUserAgentSummary("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")).toBe("Chrome 141 on macOS");
  });

  test("falls back to whichever half is known", () => {
    expect(formatUserAgentSummary("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("macOS");
    expect(formatUserAgentSummary("Mozilla/5.0 Firefox/133.0")).toBe("Firefox 133");
    expect(formatUserAgentSummary("some-internal-client/1.0")).toBe(null);
  });
});
