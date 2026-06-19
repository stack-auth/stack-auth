(async function () {
  if (typeof window === "undefined") return;

  const { HexclaveClientApp } = await import("https://esm.sh/@hexclave/js@1.0.22");

  new HexclaveClientApp({
    projectId: "internal",
    publishableClientKey: "pck_gdjdkp91a359xtb8ajypqg74se1134z8bwb36appwss7r",
    tokenStore: "cookie",
    analytics: {
      replays: {
        enabled: true,
        maskAllInputs: false,
      },
    },
  });
})();
