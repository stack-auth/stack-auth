(async function () {
  if (typeof window === "undefined") return;

  const { HexclaveClientApp } = await import("https://esm.sh/@hexclave/js@1.0.22");

  new HexclaveClientApp({
    projectId: "internal",
    publishableClientKey: "pck_3e7rwjp3mfgztqv312zs52xkn4tm9bzrnxf7w9wfcn850",
    tokenStore: "cookie",
    analytics: {
      replays: {
        enabled: true,
        maskAllInputs: false,
      },
    },
  });
})();
