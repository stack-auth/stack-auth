(function () {
  const REACT_ICON_URL = "https://d3gk2c5xim1je2.cloudfront.net/devicon/react.svg";
  const LANGUAGE_BUTTON_SELECTOR = "button[aria-haspopup='menu']";
  const LANGUAGE_ITEM_SELECTOR = "[role='menuitem']";

  function getVisibleLabelElement(root) {
    const labelCandidates = Array.from(root.querySelectorAll("p, span, div"));
    return labelCandidates.find((element) => element.children.length === 0 && element.textContent?.trim().toLowerCase() === "tsx") ?? null;
  }

  function applyReactIcon(root) {
    const icon = root.querySelector("svg");
    if (icon == null) {
      return;
    }

    icon.style.WebkitMaskImage = `url(${REACT_ICON_URL})`;
    icon.style.WebkitMaskRepeat = "no-repeat";
    icon.style.WebkitMaskPosition = "center";
    icon.style.maskImage = `url(${REACT_ICON_URL})`;
    icon.style.maskRepeat = "no-repeat";
    icon.style.maskPosition = "center";
    icon.style.maskSize = "100%";
    icon.style.backgroundColor = "currentColor";
  }

  function relabelTsxControl(root) {
    if (root.dataset.stackReactLabelApplied === "true") {
      return;
    }

    const labelElement = getVisibleLabelElement(root);
    if (labelElement == null) {
      return;
    }

    labelElement.textContent = "React";
    applyReactIcon(root);
    root.setAttribute("aria-label", root.getAttribute("aria-label")?.replace(/\btsx\b/i, "React") ?? "React");
    root.dataset.stackReactLabelApplied = "true";
  }

  function relabelTsxControls() {
    for (const element of document.querySelectorAll(`${LANGUAGE_BUTTON_SELECTOR}, ${LANGUAGE_ITEM_SELECTOR}`)) {
      relabelTsxControl(element);
    }
  }

  function installWhenReady() {
    relabelTsxControls();
    window.setTimeout(relabelTsxControls, 250);
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.requestAnimationFrame(installWhenReady);
    const observer = new MutationObserver(() => relabelTsxControls());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
