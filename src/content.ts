/// <reference path="./shared/types.ts" />

(() => {
  type Settings = AdCheckShared.Settings;
  type NetworkTabState = AdCheckShared.NetworkTabState;
  type PageCheckSnapshot = AdCheckShared.PageCheckSnapshot;
  type CheckResultBase = AdCheckShared.CheckResultBase;
  type BundleCheckResult = AdCheckShared.BundleCheckResult;
  type DomCheckResult = AdCheckShared.DomCheckResult;
  type AttributeCheckResult = AdCheckShared.AttributeCheckResult;
  type StorageCheckResult = AdCheckShared.StorageCheckResult;
  type RuntimeMessage = AdCheckShared.RuntimeMessage;

  const pageWindow = window as Window & {
    __ADCHECK_BOOTSTRAPPED__?: boolean;
  };

  const ROOT_ID = "adcheck-root";
  const HIGHLIGHT_CLASS = "adcheck-target-highlight";
  const HELP_COPY = {
    bundles: "Checks whether the ad script made a network request on this page.",
    classNames: "Looks through the page for elements using this CSS class name.",
    domIds: "Checks whether this page element ID exists and lets you jump to it.",
    attributes: "Finds every value used for this attribute anywhere in the page markup.",
    cookies: "Verifies whether this browser cookie is available to the page.",
    localStorageKeys: "Checks whether this page stored the key in local storage."
  } as const;

  const state: {
    settings: Settings;
    snapshot: PageCheckSnapshot;
    networkState: NetworkTabState;
    deadlineAt: number | null;
    root: HTMLDivElement | null;
    observer: MutationObserver | null;
    debounceHandle: number | null;
    deadlineHandle: number | null;
    pollHandle: number | null;
    rowHints: Record<string, string>;
    lastRenderSignature: string;
  } = {
    settings: AdCheckShared.cloneDefaultSettings(),
    snapshot: createEmptySnapshot(),
    networkState: AdCheckShared.createEmptyTabState(),
    deadlineAt: null,
    root: null,
    observer: null,
    debounceHandle: null,
    deadlineHandle: null,
    pollHandle: null,
    rowHints: {},
    lastRenderSignature: ""
  };

  if (!pageWindow.__ADCHECK_BOOTSTRAPPED__) {
    pageWindow.__ADCHECK_BOOTSTRAPPED__ = true;
    void bootstrap();
  }

  async function bootstrap(): Promise<void> {
    await applySettings(await loadSettings());

    chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
      if (message.type === "NETWORK_ACTIVITY_UPDATED") {
        void syncNetworkAndRefresh(false);
      }

      return undefined;
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync" || !changes[AdCheckShared.STORAGE_KEY]) {
        return;
      }

      const merged = AdCheckShared.mergeSettings(changes[AdCheckShared.STORAGE_KEY].newValue as Partial<Settings>);
      void applySettings(merged);
    });
  }

  async function applySettings(nextSettings: Settings): Promise<void> {
    state.settings = nextSettings;

    if (!nextSettings.enabled) {
      teardownWidget();
      return;
    }

    ensureWidget();
    setupObservers();
    await runChecks(true);
  }

  async function runChecks(resetDeadline: boolean): Promise<void> {
    if (!state.settings.enabled) {
      return;
    }

    if (resetDeadline) {
      state.deadlineAt = Date.now() + AdCheckShared.DEFAULT_WAIT_MS;
      scheduleDeadlineRender();
    }

    state.networkState = await getNetworkState(resetDeadline ? "REFRESH_TAB_NETWORK_STATE" : "GET_TAB_NETWORK_STATE");
    state.snapshot = buildSnapshot();
    renderWidget();
  }

  async function syncNetworkAndRefresh(resetDeadline: boolean): Promise<void> {
    state.networkState = await getNetworkState(resetDeadline ? "REFRESH_TAB_NETWORK_STATE" : "GET_TAB_NETWORK_STATE");
    state.snapshot = buildSnapshot();
    renderWidget();
  }

  function buildSnapshot(): PageCheckSnapshot {
    return {
      bundles: buildBundleResults(),
      classNames: buildClassResults(),
      domIds: buildDomResults(),
      attributes: buildAttributeResults(),
      cookies: buildCookieResults(),
      localStorageKeys: buildLocalStorageResults(),
      lastRunAt: Date.now()
    };
  }

  function buildBundleResults(): BundleCheckResult[] {
    const performanceEntries = performance.getEntriesByType("resource");

    return state.settings.bundles.map((bundleName) => {
      const normalized = bundleName.toLowerCase();
      const matchingHistory = state.networkState.history.filter((entry) => {
        if (entry.resourceType === "main_frame" || entry.resourceType === "sub_frame") {
          return false;
        }
        return entry.url.toLowerCase().includes(normalized);
      });
      const matchingCompleted = matchingHistory.find((entry) => entry.status === "completed");
      const matchingError = matchingHistory.find((entry) => entry.status === "error");
      const matchingActive = state.networkState.activeRequests.find((entry) => entry.url.toLowerCase().includes(normalized));
      const matchingPerformanceEntry = performanceEntries.find((entry) => entry.name.toLowerCase().includes(normalized));

      if (matchingCompleted) {
        return {
          key: `bundle:${bundleName}`,
          label: bundleName,
          status: "pass",
          explanation: HELP_COPY.bundles,
          detail: `Loaded from ${truncate(matchingCompleted.url, 72)} in ${matchingCompleted.loadTimeMs ?? "?"} ms.`,
          matchedUrl: matchingCompleted.url,
          loadTimeMs: matchingCompleted.loadTimeMs
        };
      }

      if (matchingPerformanceEntry) {
        return {
          key: `bundle:${bundleName}`,
          label: bundleName,
          status: "pass",
          explanation: HELP_COPY.bundles,
          detail: `Loaded from ${truncate(matchingPerformanceEntry.name, 72)} in ${Math.round(matchingPerformanceEntry.duration)} ms.`,
          matchedUrl: matchingPerformanceEntry.name,
          loadTimeMs: Math.round(matchingPerformanceEntry.duration)
        };
      }

      if (matchingActive) {
        return {
          key: `bundle:${bundleName}`,
          label: bundleName,
          status: "pending",
          explanation: HELP_COPY.bundles,
          detail: "We can see the script request in flight and are waiting for it to finish."
        };
      }

      if (matchingError && hasTimedOut()) {
        return {
          key: `bundle:${bundleName}`,
          label: bundleName,
          status: "fail",
          explanation: HELP_COPY.bundles,
          detail: `A matching request failed for ${truncate(matchingError.url, 72)}.`,
          failureMessage: "Bundle request failed before the script finished loading."
        };
      }

      return {
        key: `bundle:${bundleName}`,
        label: bundleName,
        status: hasTimedOut() ? "fail" : "pending",
        explanation: HELP_COPY.bundles,
        detail: hasTimedOut()
          ? "Bundle not found in this page's network requests."
          : "Still watching the page for this script request.",
        failureMessage: hasTimedOut() ? "Bundle not found - the ad script may not be installed on this page." : undefined
      };
    });
  }

  function buildClassResults(): CheckResultBase[] {
    return state.settings.classNames.map((className) => {
      const count = document.getElementsByClassName(className).length;
      const status = count > 0 ? "pass" : pendingOrFailedStatus();
      return {
        key: `class:${className}`,
        label: className,
        status,
        explanation: HELP_COPY.classNames,
        detail:
          count > 0
            ? `Found ${count} matching element${count === 1 ? "" : "s"} on the page.`
            : status === "pending"
              ? "Still scanning for this class name."
              : "Class name not found anywhere in the page DOM.",
        failureMessage:
          status === "fail" ? "Class name not found - the expected ad markup may not have rendered." : undefined
      };
    });
  }

  function buildDomResults(): DomCheckResult[] {
    return state.settings.domIds.map((domId) => {
      const found = Boolean(document.getElementById(domId));
      const status = found ? "pass" : pendingOrFailedStatus();
      return {
        key: `dom:${domId}`,
        label: domId,
        status,
        explanation: HELP_COPY.domIds,
        detail:
          found
            ? "Element found. Click this row to jump to it on the page."
            : status === "pending"
              ? "Still checking whether this page element appears."
              : "Element ID not found in the current page.",
        failureMessage: status === "fail" ? "Element not found on this page." : undefined,
        targetId: domId,
        found
      };
    });
  }

  function buildAttributeResults(): AttributeCheckResult[] {
    return state.settings.attributes.map((attributeName) => {
      const values = collectAttributeValues(attributeName);
      const status = values.length > 0 ? "pass" : pendingOrFailedStatus();
      const detail = values.length > 0
        ? values
            .map((valueSummary) => `"${valueSummary.value}"${valueSummary.count > 1 ? ` x${valueSummary.count}` : ""}`)
            .join(", ")
        : status === "pending"
          ? "Still scanning the page for this attribute."
          : "Attribute not found.";

      return {
        key: `attribute:${attributeName}`,
        label: attributeName,
        status,
        explanation: HELP_COPY.attributes,
        detail,
        failureMessage: status === "fail" ? "Attribute not found." : undefined,
        attributeName,
        values
      };
    });
  }

  function buildCookieResults(): StorageCheckResult[] {
    const cookies = parseCookies();

    return state.settings.cookies.map((cookieName) => {
      const value = cookies.get(cookieName);
      const status = value !== undefined ? "pass" : pendingOrFailedStatus();
      return {
        key: `cookie:${cookieName}`,
        label: cookieName,
        status,
        explanation: HELP_COPY.cookies,
        detail:
          value !== undefined
            ? `Cookie available: "${truncate(value, 54)}".`
            : status === "pending"
              ? "Still waiting to see whether this cookie appears."
              : "Cookie not found.",
        failureMessage:
          status === "fail" ? "Cookie not found - the page may be missing required ad identity data." : undefined,
        storageKind: "cookie",
        valuePreview: value
      };
    });
  }

  function buildLocalStorageResults(): StorageCheckResult[] {
    return state.settings.localStorageKeys.map((storageKey) => {
      let value: string | null = null;

      try {
        value = window.localStorage.getItem(storageKey);
      } catch {
        value = null;
      }

      const status = value !== null ? "pass" : pendingOrFailedStatus();
      return {
        key: `localStorage:${storageKey}`,
        label: storageKey,
        status,
        explanation: HELP_COPY.localStorageKeys,
        detail:
          value !== null
            ? `Stored value: "${truncate(value, 54)}".`
            : status === "pending"
              ? "Still checking page storage for this key."
              : "Local storage key not found.",
        failureMessage:
          status === "fail" ? "Local storage key not found - the page may not have saved the expected ad state." : undefined,
        storageKind: "localStorage",
        valuePreview: value ?? undefined
      };
    });
  }

  function ensureWidget(): void {
    if (state.root) {
      return;
    }

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="adcheck-widget">
        <button class="adcheck-pull-tab" id="adcheckToggleTab" type="button" aria-label="Show or hide AdCheck">
          <span>Open</span>
        </button>
        <div class="adcheck-widget-shell">
          <header class="adcheck-widget-header">
            <div>
              <p class="adcheck-widget-kicker">Publisher page review</p>
              <div class="adcheck-widget-title-row">
                <h2 class="adcheck-widget-title">AdCheck</h2>
                <span class="adcheck-badge" id="adcheckStatusBadge">0/0 clear</span>
              </div>
              <p class="adcheck-widget-subtitle">A quick read on the ad signals this page is exposing right now.</p>
            </div>
            <div class="adcheck-widget-actions">
              <button class="adcheck-button adcheck-button-secondary" id="adcheckRefreshButton" type="button">Refresh checks</button>
              <button class="adcheck-icon-button" id="adcheckHideButton" type="button" aria-label="Hide AdCheck">→</button>
            </div>
          </header>
          <div class="adcheck-group-list" id="adcheckResults"></div>
        </div>
      </div>
    `;
    document.documentElement.appendChild(root);
    state.root = root;
    bindWidgetEvents();
    renderWidget();
  }

  function teardownWidget(): void {
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    if (state.debounceHandle) {
      window.clearTimeout(state.debounceHandle);
      state.debounceHandle = null;
    }

    if (state.deadlineHandle) {
      window.clearTimeout(state.deadlineHandle);
      state.deadlineHandle = null;
    }

    if (state.pollHandle) {
      window.clearInterval(state.pollHandle);
      state.pollHandle = null;
    }

    state.rowHints = {};
    state.snapshot = createEmptySnapshot();
    state.lastRenderSignature = "";
    state.deadlineAt = null;

    if (state.root) {
      state.root.remove();
      state.root = null;
    }
  }

  function setupObservers(): void {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(() => {
      if (state.debounceHandle) {
        window.clearTimeout(state.debounceHandle);
      }

      state.debounceHandle = window.setTimeout(() => {
        state.snapshot = buildSnapshot();
        renderWidget();
      }, 160);
    });

    state.observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true
    });

    state.pollHandle = window.setInterval(() => {
      state.snapshot = buildSnapshot();
      renderWidget();
    }, 1500);
  }

  function renderWidget(): void {
    if (!state.root || !state.settings.enabled) {
      return;
    }

    const signature = JSON.stringify({
      collapsed: state.settings.widgetCollapsed,
      hints: state.rowHints,
      snapshot: state.snapshot
    });

    if (signature === state.lastRenderSignature) {
      return;
    }

    const sections = [
      renderGroup("Bundles", "Scripts we expect to load", state.snapshot.bundles),
      renderGroup("Class names", "Page classes tied to ad rendering", state.snapshot.classNames),
      renderGroup("Page elements", "IDs you can jump to on the page", state.snapshot.domIds),
      renderGroup("Attributes", "Values pulled directly from the DOM", state.snapshot.attributes),
      renderGroup("Cookies", "Browser cookies this setup may rely on", state.snapshot.cookies),
      renderGroup("Local storage", "Page storage keys this setup may need", state.snapshot.localStorageKeys)
    ].join("");

    const widget = state.root.querySelector<HTMLElement>(".adcheck-widget");
    const results = state.root.querySelector<HTMLElement>("#adcheckResults");
    const badge = state.root.querySelector<HTMLElement>("#adcheckStatusBadge");
    const toggleLabel = state.root.querySelector<HTMLElement>("#adcheckToggleTab span");

    widget?.classList.toggle("is-collapsed", state.settings.widgetCollapsed);
    if (results) {
      results.innerHTML = sections;
    }
    if (badge) {
      badge.textContent = `${countPassingChecks()}/${countTotalChecks()} clear`;
    }
    if (toggleLabel) {
      toggleLabel.textContent = state.settings.widgetCollapsed ? "Open" : "Hide";
    }

    bindResultEvents();
    state.lastRenderSignature = signature;
  }

  function renderGroup(title: string, description: string, results: CheckResultBase[]): string {
    const passedCount = results.filter((result) => result.status === "pass").length;

    return `
      <section class="adcheck-group">
        <div class="adcheck-group-heading">
          <div>
            <h3 class="adcheck-group-title">${escapeHtml(title)}</h3>
            <p class="adcheck-group-description">${escapeHtml(description)}</p>
          </div>
          <div class="adcheck-group-meta">${passedCount}/${results.length}</div>
        </div>
        <div class="adcheck-results">
          ${results.map((result) => renderResult(result)).join("")}
        </div>
      </section>
    `;
  }

  function renderResult(result: CheckResultBase): string {
    const rowClass = `adcheck-result-row is-${result.status}${isDomResult(result) ? " is-clickable" : ""}`;
    const statusIcon = result.status === "pass" ? "✓" : result.status === "fail" ? "×" : "";
    const detailClasses = result.failureMessage ? "adcheck-result-detail adcheck-result-failure" : "adcheck-result-detail";
    const hint = state.rowHints[result.key];
    const domAction = isDomResult(result)
      ? `<button class="adcheck-dom-jump" data-dom-id="${escapeAttribute(result.targetId)}" type="button">Jump to element</button>`
      : "";

    return `
      <div class="${rowClass}" ${isDomResult(result) ? `data-dom-result="${escapeAttribute(result.targetId)}"` : ""}>
        <div class="adcheck-status-icon is-${result.status}">${statusIcon}</div>
        <div>
          <div class="adcheck-result-label-row">
            <span class="adcheck-result-label" title="${escapeAttribute(result.explanation)}">${escapeHtml(result.label)}</span>
            <span class="adcheck-result-pill">${escapeHtml(result.status)}</span>
          </div>
          <p class="adcheck-result-explanation">${escapeHtml(result.explanation)}</p>
          <p class="adcheck-result-detail">${escapeHtml(result.detail)}</p>
          ${result.failureMessage ? `<p class="${detailClasses}">${escapeHtml(result.failureMessage)}</p>` : ""}
          ${hint ? `<p class="adcheck-result-detail adcheck-result-failure">${escapeHtml(hint)}</p>` : ""}
          ${domAction}
        </div>
      </div>
    `;
  }

  function bindWidgetEvents(): void {
    if (!state.root) {
      return;
    }

    state.root.querySelector<HTMLButtonElement>("#adcheckRefreshButton")?.addEventListener("click", () => {
      void runChecks(true);
    });

    state.root.querySelector<HTMLButtonElement>("#adcheckHideButton")?.addEventListener("click", () => {
      void persistCollapsedState(true);
    });

    state.root.querySelector<HTMLButtonElement>("#adcheckToggleTab")?.addEventListener("click", () => {
      void persistCollapsedState(!state.settings.widgetCollapsed);
    });
  }

  function bindResultEvents(): void {
    if (!state.root) {
      return;
    }

    for (const button of Array.from(state.root.querySelectorAll<HTMLButtonElement>("[data-dom-id]"))) {
      button.addEventListener("click", (event: Event) => {
        event.stopPropagation();
        void navigateToDomId(button.dataset.domId ?? "");
      });
    }

    for (const row of Array.from(state.root.querySelectorAll<HTMLElement>("[data-dom-result]"))) {
      row.addEventListener("click", () => {
        void navigateToDomId(row.dataset.domResult ?? "");
      });
    }
  }

  async function navigateToDomId(domId: string): Promise<void> {
    if (!domId) {
      return;
    }

    const target = document.getElementById(domId);
    if (!target) {
      setRowHint(`dom:${domId}`, "Element not found on this page.");
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest"
    });
    target.classList.add(HIGHLIGHT_CLASS);
    window.setTimeout(() => {
      target.classList.remove(HIGHLIGHT_CLASS);
    }, 2000);
  }

  function setRowHint(key: string, message: string): void {
    state.rowHints[key] = message;
    renderWidget();
    window.setTimeout(() => {
      if (state.rowHints[key] === message) {
        delete state.rowHints[key];
        renderWidget();
      }
    }, 2000);
  }

  async function persistCollapsedState(nextCollapsed: boolean): Promise<void> {
    const merged = {
      ...state.settings,
      widgetCollapsed: nextCollapsed
    };

    await chrome.storage.sync.set({
      [AdCheckShared.STORAGE_KEY]: merged
    });
  }

  function scheduleDeadlineRender(): void {
    if (state.deadlineHandle) {
      window.clearTimeout(state.deadlineHandle);
    }

    state.deadlineHandle = window.setTimeout(() => {
      state.snapshot = buildSnapshot();
      renderWidget();
    }, AdCheckShared.DEFAULT_WAIT_MS + 50);
  }

  function pendingOrFailedStatus(): AdCheckShared.CheckStatus {
    return hasTimedOut() ? "fail" : "pending";
  }

  function hasTimedOut(): boolean {
    return state.deadlineAt !== null && Date.now() >= state.deadlineAt;
  }

  function parseCookies(): Map<string, string> {
    const cookieMap = new Map<string, string>();

    if (!document.cookie) {
      return cookieMap;
    }

    for (const rawPair of document.cookie.split(";")) {
      const [name, ...rest] = rawPair.split("=");
      cookieMap.set(name.trim(), decodeURIComponent(rest.join("=").trim()));
    }

    return cookieMap;
  }

  function collectAttributeValues(attributeName: string): AdCheckShared.AttributeValueSummary[] {
    const elements = document.querySelectorAll(`[${cssEscape(attributeName)}]`);
    const counts = new Map<string, number>();

    for (const element of Array.from(elements)) {
      const value = element.getAttribute(attributeName);
      if (value === null) {
        continue;
      }

      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([value, count]) => ({
      value,
      count
    }));
  }

  function countPassingChecks(): number {
    const allResults = [
      ...state.snapshot.bundles,
      ...state.snapshot.classNames,
      ...state.snapshot.domIds,
      ...state.snapshot.attributes,
      ...state.snapshot.cookies,
      ...state.snapshot.localStorageKeys
    ];

    return allResults.filter((result) => result.status === "pass").length;
  }

  function countTotalChecks(): number {
    return (
      state.snapshot.bundles.length +
      state.snapshot.classNames.length +
      state.snapshot.domIds.length +
      state.snapshot.attributes.length +
      state.snapshot.cookies.length +
      state.snapshot.localStorageKeys.length
    );
  }

  function createEmptySnapshot(): PageCheckSnapshot {
    return {
      bundles: [],
      classNames: [],
      domIds: [],
      attributes: [],
      cookies: [],
      localStorageKeys: [],
      lastRunAt: Date.now()
    };
  }

  async function loadSettings(): Promise<Settings> {
    const response = await sendMessage<{ ok: boolean; settings?: Settings }>({
      type: "GET_SETTINGS"
    });

    return AdCheckShared.mergeSettings(response?.settings);
  }

  async function getNetworkState(messageType: "GET_TAB_NETWORK_STATE" | "REFRESH_TAB_NETWORK_STATE"): Promise<NetworkTabState> {
    const response = await sendMessage<{ ok: boolean; state?: NetworkTabState }>({
      type: messageType
    });

    return response?.state ?? AdCheckShared.createEmptyTabState();
  }

  async function sendMessage<ResponseType>(message: RuntimeMessage): Promise<ResponseType | null> {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return null;
    }
  }

  function cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }

    return value.replace(/["\\\]]/g, "\\$&");
  }

  function escapeHtml(value: string): string {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttribute(value: string): string {
    return escapeHtml(value);
  }

  function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
      return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
  }

  function isDomResult(result: CheckResultBase): result is DomCheckResult {
    return result.key.startsWith("dom:");
  }
})();
