import { describe, expect, it } from "vitest";
import {
  GROWTH_REPORT_PRESENTATION_MAX_SOURCE_BYTES,
  validateGrowthReportPresentationSource,
} from "./report-presentation";

describe("validateGrowthReportPresentationSource", () => {
  it("accepts realistic JSX source for the sandbox to compile later", () => {
    expect(() => validateGrowthReportPresentationSource(`
      const Dashboard = () => <div className="p-6">Growth results</div>;
    `)).not.toThrow();
  });

  it("rejects empty and oversized source", () => {
    expect(() => validateGrowthReportPresentationSource(" \n\t")).toThrow(/must not be empty/);
    expect(() => validateGrowthReportPresentationSource(`const Dashboard = () => null;${"x".repeat(GROWTH_REPORT_PRESENTATION_MAX_SOURCE_BYTES)}`))
      .toThrow(/must be at most/);
  });

  it("rejects source without Dashboard but leaves JSX compilation to the sandbox", () => {
    expect(() => validateGrowthReportPresentationSource("const App = () => null;")).toThrow(/define a top-level Dashboard/);
    expect(() => validateGrowthReportPresentationSource("const Dashboard = <div>unfinished")).not.toThrow();
  });

  it("rejects top-level module syntax without matching words inside source text", () => {
    expect(() => validateGrowthReportPresentationSource(`
      import { Card } from "ui";
      const Dashboard = () => <div>Growth results</div>;
    `)).toThrow(/must not use import or export/);
    expect(() => validateGrowthReportPresentationSource(`
      const Dashboard = () => <div>export this report</div>;
    `)).not.toThrow();
  });
});
