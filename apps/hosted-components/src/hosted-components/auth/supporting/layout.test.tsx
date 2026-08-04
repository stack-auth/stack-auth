import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HostedAuthMessage } from "./layout";

describe("HostedAuthMessage", () => {
  it("renders a terminal card without an empty action area", () => {
    const markup = renderToStaticMarkup(
      <HostedAuthMessage title="Finished">
        You can close this tab.
      </HostedAuthMessage>,
    );

    expect(markup).toContain("Finished");
    expect(markup).toContain("You can close this tab.");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("mt-6 flex flex-col gap-2.5");
  });
});
