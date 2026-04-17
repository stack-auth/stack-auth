import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

export function isPreviewModeEnabled() {
  return getEnvVariable("NEXT_PUBLIC_STACK_IS_PREVIEW", "") === "true";
}

export function generatePreviewReplayEvents(startTs: number): any[] {
  return [
    // Meta event
    { type: 4, data: { href: "https://example.com", width: 1280, height: 720 }, timestamp: startTs },
    // Full snapshot — a simple page with content
    {
      type: 2,
      data: {
        node: {
          type: 0, childNodes: [{
            type: 1, name: "html", publicId: "", systemId: "", id: 2,
          }, {
            type: 2, tagName: "html", attributes: {}, id: 3, childNodes: [
              {
                type: 2, tagName: "head", attributes: {}, id: 4, childNodes: [
                  { type: 2, tagName: "title", attributes: {}, id: 5, childNodes: [{ type: 3, textContent: "My App", id: 6 }] },
                ],
              },
              {
                type: 2, tagName: "body", attributes: { style: "margin:0;font-family:system-ui,sans-serif;background:#f8fafc" }, id: 7, childNodes: [
                  {
                    type: 2, tagName: "div", attributes: { style: "max-width:800px;margin:40px auto;padding:0 20px" }, id: 8, childNodes: [
                      { type: 2, tagName: "h1", attributes: { style: "color:#0f172a;font-size:28px;margin-bottom:8px" }, id: 9, childNodes: [{ type: 3, textContent: "Welcome to My App", id: 10 }] },
                      { type: 2, tagName: "p", attributes: { style: "color:#64748b;font-size:16px;line-height:1.6" }, id: 11, childNodes: [{ type: 3, textContent: "This is a preview of a session replay. The user browsed the landing page and clicked around.", id: 12 }] },
                      {
                        type: 2, tagName: "div", attributes: { style: "display:flex;gap:12px;margin-top:24px" }, id: 13, childNodes: [
                          { type: 2, tagName: "button", attributes: { style: "padding:10px 24px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer" }, id: 14, childNodes: [{ type: 3, textContent: "Get Started", id: 15 }] },
                          { type: 2, tagName: "button", attributes: { style: "padding:10px 24px;background:white;color:#334155;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;cursor:pointer" }, id: 16, childNodes: [{ type: 3, textContent: "Learn More", id: 17 }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          }],
          id: 1,
        },
        initialOffset: { left: 0, top: 0 },
      },
      timestamp: startTs + 100,
    },
    // Mouse movements and clicks
    { type: 3, data: { source: 1, positions: [{ x: 400, y: 300, id: 7, timeOffset: 0 }] }, timestamp: startTs + 2000 },
    { type: 3, data: { source: 1, positions: [{ x: 350, y: 350, id: 14, timeOffset: 0 }] }, timestamp: startTs + 3000 },
    { type: 3, data: { source: 2, type: 2, id: 14, x: 350, y: 350 }, timestamp: startTs + 3500 },
    { type: 3, data: { source: 1, positions: [{ x: 500, y: 350, id: 16, timeOffset: 0 }] }, timestamp: startTs + 5000 },
    { type: 3, data: { source: 2, type: 2, id: 16, x: 500, y: 350 }, timestamp: startTs + 5500 },
    { type: 3, data: { source: 1, positions: [{ x: 400, y: 200, id: 9, timeOffset: 0 }] }, timestamp: startTs + 7000 },
  ];
}
