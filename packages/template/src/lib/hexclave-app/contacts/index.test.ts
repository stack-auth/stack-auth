import { describe, expect, it } from "vitest";
import {
  serverContactChannelCreateOptionsToCrud,
  serverContactCreateOptionsToCrud,
} from ".";

describe("contacts SDK wire mapping", () => {
  it("maps camelCase contact and channel options to the REST contract", () => {
    expect(serverContactCreateOptionsToCrud({
      displayName: "Ada",
      profileImageUrl: "https://example.com/ada.png",
      contactChannels: [{
        type: "slack",
        value: "U123",
        workspaceId: "T456",
        isPrimary: true,
      }],
    })).toMatchInlineSnapshot(`
      {
        "channels": [
          {
            "is_primary": true,
            "is_verified": undefined,
            "metadata": undefined,
            "type": "slack",
            "value": "U123",
            "workspace_id": "T456",
          },
        ],
        "client_metadata": undefined,
        "client_read_only_metadata": undefined,
        "display_name": "Ada",
        "id": undefined,
        "profile_image_url": "https://example.com/ada.png",
        "server_metadata": undefined,
      }
    `);
  });

  it("keeps generalized channel inputs camelCase", () => {
    expect(serverContactChannelCreateOptionsToCrud({
      type: "push",
      value: "device-token",
      provider: "apns",
      appId: "com.example.app",
      environment: "production",
    })).toMatchInlineSnapshot(`
      {
        "app_id": "com.example.app",
        "environment": "production",
        "is_primary": undefined,
        "is_verified": undefined,
        "metadata": undefined,
        "provider": "apns",
        "type": "push",
        "value": "device-token",
      }
    `);
  });
});
