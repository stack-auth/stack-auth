import { describe, expect, it } from "vitest";
import { ALL_APPS_FRONTEND, DUMMY_ORIGIN, getItemPath, testItemPath, type NavigableAppFrontend } from "./apps-frontend";

const PROJECT_ID = "demo-project";

function urlFor(path: string): URL {
  return new URL(path, DUMMY_ORIGIN);
}

// Path matching only reads `href` and `navigationItems`; the presentational fields are filled with the
// cheapest valid values so the fixture stays a real AppFrontend rather than a cast.
function appWith(navigationItems: NavigableAppFrontend["navigationItems"], href = "gtm"): NavigableAppFrontend {
  return {
    icon: () => <svg />,
    href,
    navigationItems,
    screenshots: [],
    storeDescription: <p>Fixture app.</p>,
  };
}

describe("testItemPath", () => {
  const overview = { displayName: "Overview", href: "." };
  const admin = { displayName: "Admin", href: "admin" };
  const gtm = appWith([overview, admin]);

  it("marks the parent item active on its own page", () => {
    expect(testItemPath(PROJECT_ID, gtm, overview, urlFor("/projects/demo-project/gtm"))).toBe(true);
    expect(testItemPath(PROJECT_ID, gtm, admin, urlFor("/projects/demo-project/gtm"))).toBe(false);
  });

  it("deselects a parent item when a nested sibling is the page being viewed", () => {
    // The Admin page lives underneath the Overview item's own path, so a plain prefix match would light up
    // both entries in the sidebar at once.
    expect(testItemPath(PROJECT_ID, gtm, admin, urlFor("/projects/demo-project/gtm/admin"))).toBe(true);
    expect(testItemPath(PROJECT_ID, gtm, overview, urlFor("/projects/demo-project/gtm/admin"))).toBe(false);
  });

  it("keeps the parent item active on nested pages no sibling claims", () => {
    expect(testItemPath(PROJECT_ID, gtm, overview, urlFor("/projects/demo-project/gtm/insights/abc"))).toBe(true);
    expect(testItemPath(PROJECT_ID, gtm, admin, urlFor("/projects/demo-project/gtm/insights/abc"))).toBe(false);
  });

  it("keeps the parent active on the nested page's own children", () => {
    const deep = urlFor("/projects/demo-project/gtm/admin/other-project/insights/abc");
    expect(testItemPath(PROJECT_ID, gtm, admin, deep)).toBe(true);
    expect(testItemPath(PROJECT_ID, gtm, overview, deep)).toBe(false);
  });

  it("leaves sibling items that do not nest alone", () => {
    const authMethods = { displayName: "Auth Methods", href: "." };
    const signUpRules = { displayName: "Sign-up Rules", href: "../sign-up-rules" };
    const auth = appWith([authMethods, signUpRules], "auth-methods");

    expect(testItemPath(PROJECT_ID, auth, authMethods, urlFor("/projects/demo-project/auth-methods"))).toBe(true);
    expect(testItemPath(PROJECT_ID, auth, signUpRules, urlFor("/projects/demo-project/auth-methods"))).toBe(false);
    expect(testItemPath(PROJECT_ID, auth, signUpRules, urlFor("/projects/demo-project/sign-up-rules"))).toBe(true);
    expect(testItemPath(PROJECT_ID, auth, authMethods, urlFor("/projects/demo-project/sign-up-rules"))).toBe(false);
  });

  it("lets an item's own matchPath decide, and never ranks it against siblings", () => {
    const custom = { displayName: "Custom", href: "custom", matchPath: (path: string) => path.includes("/gtm/") };
    const app = appWith([overview, custom]);

    expect(testItemPath(PROJECT_ID, app, custom, urlFor("/projects/demo-project/gtm/anything"))).toBe(true);
    // The custom item matching does not deselect the parent, since there is no path to compare it on.
    expect(testItemPath(PROJECT_ID, app, overview, urlFor("/projects/demo-project/gtm/anything"))).toBe(true);
  });

  it("never marks an external item active", () => {
    const external = { displayName: "Docs", href: "https://docs.hexclave.com", external: true };
    const app = appWith([overview, external]);

    expect(testItemPath(PROJECT_ID, app, external, urlFor("/projects/demo-project/gtm"))).toBe(false);
  });
});

describe("Analytics and Observability navigation", () => {
  it("keeps removed and code surfaces out of Analytics navigation", () => {
    const analyticsItems = ALL_APPS_FRONTEND.analytics.navigationItems.map((item) => item.displayName);
    expect(analyticsItems).not.toContain("Overview");
    expect(analyticsItems).not.toContain("Users");
    expect(analyticsItems).not.toContain("Events");
    expect(analyticsItems).not.toContain("Saved Views");
    expect(analyticsItems).not.toContain("Logs");
    expect(analyticsItems).not.toContain("Traces");

    const observability = ALL_APPS_FRONTEND.observability;
    const logs = observability.navigationItems.find((item) => item.displayName === "Logs");
    const traces = observability.navigationItems.find((item) => item.displayName === "Traces");
    if (logs == null || traces == null) throw new Error("Observability must define Logs and Traces navigation.");
    expect(getItemPath(PROJECT_ID, observability, logs)).toBe("/projects/demo-project/observability/logs");
    expect(getItemPath(PROJECT_ID, observability, traces)).toBe("/projects/demo-project/observability/traces");
  });
});
