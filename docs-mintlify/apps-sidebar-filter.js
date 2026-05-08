(function () {
  const SEARCH_ATTRIBUTE = "data-apps-sidebar-search";
  const EMPTY_ATTRIBUTE = "data-apps-sidebar-empty";

  function isPageDarkTheme() {
    const body = document.body;
    return document.documentElement.classList.contains("dark")
      || document.documentElement.getAttribute("data-theme") === "dark"
      || body?.classList.contains("dark") === true
      || body?.getAttribute("data-theme") === "dark";
  }

  function applySidebarAppsFilterTheme(searchInput, emptyState, clearFilterButton) {
    const isDark = isPageDarkTheme();
    searchInput.style.background = isDark ? "rgba(17,24,39,0.72)" : "rgba(248,250,252,0.98)";
    searchInput.style.color = isDark ? "#e5e7eb" : "#111827";
    searchInput.style.border = isDark ? "1px solid rgba(75,85,99,0.9)" : "1px solid rgba(203,213,225,0.95)";
    emptyState.style.color = isDark ? "rgba(203,213,225,0.86)" : "rgba(55,65,81,0.9)";
    clearFilterButton.style.color = isDark ? "#8fb7ff" : "#295fbe";
  }

  function installAppsSidebarFilter() {
    const navigationItems = document.querySelector("#navigation-items");
    if (navigationItems == null) {
      return false;
    }

    const sidebarHeaders = navigationItems.querySelectorAll(".sidebar-group-header");
    const appsHeader = Array.from(sidebarHeaders).find((header) => header.textContent?.trim() === "Apps");
    if (appsHeader == null) {
      return false;
    }

    const appsGroupContainer = appsHeader.parentElement;
    const appsList = appsGroupContainer?.querySelector("ul");
    if (appsGroupContainer == null || appsList == null) {
      return false;
    }

    const existingSearchInput = appsHeader.querySelector(`input[${SEARCH_ATTRIBUTE}="true"]`);
    if (existingSearchInput != null) {
      const existingEmptyState = appsGroupContainer.querySelector(`div[${EMPTY_ATTRIBUTE}="true"]`);
      const existingClearFilterButton = existingEmptyState?.querySelector("button");
      if (existingEmptyState != null && existingClearFilterButton != null) {
        applySidebarAppsFilterTheme(existingSearchInput, existingEmptyState, existingClearFilterButton);
      }
      return true;
    }

    const legacySearchContainers = appsGroupContainer.querySelectorAll(`div[${SEARCH_ATTRIBUTE}="true"]`);
    for (const legacySearchContainer of legacySearchContainers) {
      legacySearchContainer.remove();
    }
    const existingEmptyStates = appsGroupContainer.querySelectorAll(`[${EMPTY_ATTRIBUTE}="true"]`);
    for (const existingEmptyState of existingEmptyStates) {
      existingEmptyState.remove();
    }

    const searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Filter...";
    searchInput.setAttribute("aria-label", "Filter apps in sidebar");
    searchInput.setAttribute(SEARCH_ATTRIBUTE, "true");
    searchInput.style.width = "120px";
    searchInput.style.height = "24px";
    searchInput.style.borderRadius = "7px";
    searchInput.style.padding = "0 8px";
    searchInput.style.fontSize = "11px";
    searchInput.style.lineHeight = "1";
    searchInput.style.outline = "none";
    searchInput.style.transition = "border-color 150ms ease, background-color 150ms ease, color 150ms ease";
    searchInput.style.fontWeight = "500";
    searchInput.style.marginLeft = "auto";
    searchInput.style.flexShrink = "0";

    const emptyState = document.createElement("div");
    emptyState.setAttribute(EMPTY_ATTRIBUTE, "true");
    emptyState.style.display = "none";
    emptyState.style.padding = "2px 0 8px 16px";
    emptyState.style.fontSize = "12px";
    emptyState.style.lineHeight = "1.3";

    const emptyStatePrefix = document.createElement("span");
    emptyStatePrefix.textContent = "No more results. ";
    emptyState.appendChild(emptyStatePrefix);

    const clearFilterButton = document.createElement("button");
    clearFilterButton.type = "button";
    clearFilterButton.textContent = "Clear filter";
    clearFilterButton.style.border = "none";
    clearFilterButton.style.padding = "0";
    clearFilterButton.style.background = "transparent";
    clearFilterButton.style.fontSize = "12px";
    clearFilterButton.style.fontWeight = "600";
    clearFilterButton.style.cursor = "pointer";
    clearFilterButton.style.textDecoration = "underline";
    clearFilterButton.style.textUnderlineOffset = "2px";
    emptyState.appendChild(clearFilterButton);

    const filterSidebarApps = () => {
      const query = searchInput.value.trim().toLowerCase();
      const appRows = Array.from(appsList.children);
      let visibleCount = 0;
      for (const row of appRows) {
        const searchableElement = row.querySelector("a, button") ?? row;
        const rowText = searchableElement.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
        const isVisible = query.length === 0 || rowText.includes(query);
        row.style.display = isVisible ? "" : "none";
        if (isVisible) {
          visibleCount += 1;
        }
      }
      emptyState.style.display = query.length > 0 && visibleCount === 0 ? "block" : "none";
    };

    clearFilterButton.addEventListener("click", () => {
      searchInput.value = "";
      filterSidebarApps();
      searchInput.focus();
    });
    searchInput.addEventListener("input", filterSidebarApps);
    applySidebarAppsFilterTheme(searchInput, emptyState, clearFilterButton);

    appsHeader.style.display = "flex";
    appsHeader.style.alignItems = "center";
    appsHeader.style.gap = "8px";
    appsHeader.style.paddingRight = "12px";
    appsHeader.appendChild(searchInput);
    appsGroupContainer.insertBefore(emptyState, appsList);
    return true;
  }

  function installWhenReady() {
    if (installAppsSidebarFilter()) {
      return;
    }
    window.setTimeout(installWhenReady, 250);
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.requestAnimationFrame(installWhenReady);
    const observer = new MutationObserver(() => installAppsSidebarFilter());
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-theme"] });
  }
})();
