/// <reference path="./shared/types.ts" />

(() => {
  self.importScripts("shared/defaults.js");

	type Settings = AdCheckShared.Settings;
	type NetworkTabState = AdCheckShared.NetworkTabState;
  type ActiveNetworkRequest = AdCheckShared.ActiveNetworkRequest;
  type RuntimeMessage = AdCheckShared.RuntimeMessage;
  type WebRequestLike = {
    statusCode?: number;
    error?: string;
    requestId: string;
    tabId: number;
    timeStamp: number;
    type: string;
    url: string;
  };

  type PendingRequest = ActiveNetworkRequest & {
    tabId: number;
  };

  const ACTION_ICON_PATHS = {
    color: {
      16: "icons/16.png",
      48: "icons/48.png",
      128: "icons/128.png"
    },
    gray: {
      16: "icons/16-gray.png",
      48: "icons/48-gray.png",
      128: "icons/128-gray.png"
    }
  } as const;

	const settingsCache: { current: Settings } = {
		current: AdCheckShared.cloneDefaultSettings()
	};

	const tabStateCache = new Map<number, NetworkTabState>();
	const pendingRequests = new Map<string, PendingRequest>();
	const BLOCKED_ROUTE_RULE_ID_BASE = 100000;
  let trackingReady = false;
  let settingsRevision = 0;
  const earlyEvents: (() => void)[] = [];
  // Bound the startup queue so a failing settings load cannot grow memory without limit.
  const MAX_EARLY_EVENTS = 1000;
  function whenTrackingReady(event: () => void): void {
    if (trackingReady) event();
    else if (earlyEvents.length < MAX_EARLY_EVENTS) earlyEvents.push(event);
  }

  function markTrackingReady(): void {
    trackingReady = true;
    for (const event of earlyEvents.splice(0)) event();
  }

  queueMicrotask(() => {
    void initialize().catch((error: unknown) => {
      console.warn("AdCheck initialization failed; continuing with cached settings:", error);
      markTrackingReady();
    });
  });

  chrome.runtime.onInstalled.addListener(() => {
    void ensureSettings();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

		const nextValue = changes[AdCheckShared.STORAGE_KEY]?.newValue as Partial<Settings> | undefined;
		if (nextValue) {
			settingsRevision++;
      const previous = settingsCache.current;
      settingsCache.current = AdCheckShared.mergeSettings(nextValue);
      // Editing bundle names keeps history so the widget can re-evaluate the
      // already-loaded page immediately; only tracking on/off changes clear it.
      const next = settingsCache.current;
      if (previous.enabled !== next.enabled || (previous.bundles.length > 0) !== (next.bundles.length > 0) || JSON.stringify(previous.ignoredDomains) !== JSON.stringify(next.ignoredDomains)) {
        for (const tabId of tabStateCache.keys()) clearTabTracking(tabId, false);
      }
			void syncBlockedRouteRules();
			void syncActionIcons();
		}
	});

  chrome.tabs.onActivated.addListener(() => {
    void syncActionIcons();
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    // Title, favicon, and loading-state updates cannot change blocking scope.
    if (changeInfo.url) void syncBlockedRouteRules();
    void syncActionIcons();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    whenTrackingReady(() => clearTabTracking(tabId));
    void syncBlockedRouteRules();
  });

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      whenTrackingReady(() => handleBeforeRequest(details as WebRequestLike));
      return undefined;
    },
    { urls: ["http://*/*", "https://*/*"] }
  );

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      whenTrackingReady(() => finalizeRequest(details as WebRequestLike, "completed"));
    },
    { urls: ["http://*/*", "https://*/*"] }
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      whenTrackingReady(() => finalizeRequest(details as WebRequestLike, "error"));
    },
    { urls: ["http://*/*", "https://*/*"] }
  );

  chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
    void handleRuntimeMessage(message, sender)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      });

    return true;
  });

	async function initialize(): Promise<void> {
		await ensureSettings();

		await syncBlockedRouteRules();
		await syncActionIcons();
	}

  let settingsLoad: Promise<Settings> | null = null;
  function ensureSettings(): Promise<Settings> {
    if (settingsLoad) return settingsLoad;
    settingsLoad = loadSettingsState().finally(() => { settingsLoad = null; });
    return settingsLoad;
  }

  async function loadSettingsState(): Promise<Settings> {
    const revision = settingsRevision;
    const result = await chrome.storage.sync.get(AdCheckShared.STORAGE_KEY);
    const merged = revision === settingsRevision ? AdCheckShared.mergeSettings(result[AdCheckShared.STORAGE_KEY] as Partial<Settings> | undefined) : settingsCache.current;

    if (!result[AdCheckShared.STORAGE_KEY]) {
      await chrome.storage.sync.set({
        [AdCheckShared.STORAGE_KEY]: merged
      });
    }

		settingsCache.current = merged;
    if (!trackingReady) {
      try {
        const stored = await chrome.storage.session.get();
        for (const [key, value] of Object.entries(stored)) {
          if (!key.startsWith(AdCheckShared.TAB_STATE_PREFIX)) continue;
          const tabId = Number(key.slice(AdCheckShared.TAB_STATE_PREFIX.length));
          // Only restore the redacted, versioned state written by this reducer.
          if (value?.version !== 1 || !Array.isArray(value.state?.history) || !Array.isArray(value.state?.activeRequests)) {
            await chrome.storage.session.remove(key); continue;
          }
          if (settingsCache.current.enabled && settingsCache.current.bundles.length) {
            tabStateCache.set(tabId, value.state);
            for (const request of value.state.activeRequests) pendingRequests.set(requestKey(tabId, request.requestId), {...request, tabId});
          } else { await chrome.storage.session.remove(key); }
        }
      } catch (error) { console.warn("AdCheck request history could not be restored:", error); }
      try {
        const openTabs = await chrome.tabs.query({});
        for (const tab of openTabs) {
          try { if (typeof tab.id === "number") tabHosts.set(tab.id, new URL(tab.url ?? "").hostname); } catch { /* Non-web tab. */ }
        }
      } catch (error) { console.warn("AdCheck could not read open tabs:", error); }
    }
    for (const tabId of tabStateCache.keys()) {
      if (!tabHosts.has(tabId)) clearTabTracking(tabId);
      else if (!settingsCache.current.enabled || !settingsCache.current.bundles.length || settingsCache.current.ignoredDomains.some(entry => AdCheckShared.matchesIgnoredDomain(entry, tabHosts.get(tabId)!))) clearTabTracking(tabId, false);
    }
    markTrackingReady();
		return settingsCache.current;
	}

  async function handleRuntimeMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (message.type) {
      case "GET_SETTINGS":
        return {
          ok: true,
          settings: await ensureSettings()
        };
      case "GET_USER_SCRIPT_STATUS":
        return {
          ok: true,
          status: await getUserScriptStatus()
        };
      case "GET_TAB_NETWORK_STATE":
      case "REFRESH_TAB_NETWORK_STATE": {
        if (!trackingReady) await ensureSettings();
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number") {
          return {
            ok: false,
            state: AdCheckShared.createEmptyTabState()
          };
        }

        return {
          ok: true,
          state: await getTabState(tabId)
        };
      }
      case "NETWORK_ACTIVITY_UPDATED":
        return { ok: true };
      case "SET_ACTION_SUCCESS_STATE": {
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number") {
          return { ok: false };
        }

        await updateActionBadge(tabId, message.allPass === true);
        return { ok: true };
      }
		case "SYNC_ACTION_STATE":
			await syncActionIcons();
			return { ok: true };
		case "SYNC_BLOCKED_ROUTE_RULES":
      await ensureSettings();
			await syncBlockedRouteRules();
			return { ok: true, statuses: blockingStatus, installedCount: (await chrome.declarativeNetRequest.getSessionRules()).length };
		case "EXECUTE_SITE_OVERRIDE_SCRIPT": {
        const tabId = sender.tab?.id;
        const hasInlineCode = typeof message.scriptCode === "string" && message.scriptCode.trim().length > 0;
        const hasExternalUrl = typeof message.scriptUrl === "string" && message.scriptUrl.trim().length > 0;
        if (typeof tabId !== "number" || hasInlineCode === hasExternalUrl) {
          return { ok: false, error: "Provide one inline script or external script URL." };
        }

        try {
          await executeSiteOverrideScript(
            tabId,
            sender.frameId,
            message.scriptCode,
            message.scriptUrl,
            message.scriptCredentials,
            sender.origin
          );
          return { ok: true };
        } catch (error: unknown) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "The site override script could not be executed."
          };
        }
      }
      case "READ_WINDOW_GLOBALS": {
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number" || !Array.isArray(message.windowGlobalPaths) || message.windowGlobalPaths.length === 0) {
          return { ok: false, error: "Missing tab or global paths." };
        }

        const results = await readWindowGlobals(tabId, sender.frameId, message.windowGlobalPaths);
        return { ok: true, results };
      }
      default:
        return { ok: false, error: "Unsupported message." };
    }
  }

  async function executeSiteOverrideScript(
    tabId: number,
    frameId: number | undefined,
    inlineCode: string | undefined,
    externalUrl: string | undefined,
    credentials: RequestCredentials | undefined,
    senderOrigin: string | undefined
  ): Promise<void> {
    const userScriptsApi = getUserScriptsApi();
    let scriptCode = inlineCode;

    if (externalUrl) {
      const parsedUrl = new URL(externalUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS external scripts can use the fallback loader.");
      }

      const canIncludeCredentials = credentials === "include" && parsedUrl.origin === senderOrigin;
      const response = await fetch(parsedUrl.href, {
        credentials: canIncludeCredentials ? "include" : "omit"
      });
      if (!response.ok) {
        throw new Error(`External script fallback returned HTTP ${response.status} for ${parsedUrl.href}`);
      }

      scriptCode = `${await response.text()}\n//# sourceURL=${parsedUrl.href.replace(/[\r\n]/g, "")}`;
    }

    if (!scriptCode) {
      throw new Error("The site override script was empty.");
    }

    const injectionResults = await userScriptsApi.execute({
      target: typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId },
      injectImmediately: true,
      js: [{ code: scriptCode }],
      world: "MAIN"
    });

    const injectionError = injectionResults.find((result) => result.error)?.error;
    if (injectionError) {
      throw new Error(injectionError);
    }
  }

  let blockingSync = Promise.resolve();
  let blockingStatus: { value: string; state: string; message: string }[] = [];
  function syncBlockedRouteRules(): Promise<void> {
    blockingSync = blockingSync.catch(() => {}).then(installBlockedRules);
    return blockingSync.catch(error => {
      blockingStatus = settingsCache.current.blockedRoutes.map(entry => ({value: entry.value, state: "saved", message: `Could not synchronize with Chrome: ${String(error)}`}));
    });
  }

  async function installBlockedRules(): Promise<void> {
    const dnr = chrome.declarativeNetRequest;
    const settings = settingsCache.current;
    const tabs = await chrome.tabs.query({});
    const tabIds = tabs.filter(tab => {
      try {
        const hostname = new URL(tab.url ?? "").hostname;
        return hostname === settings.blockingHostname && !settings.ignoredDomains.some(entry => AdCheckShared.matchesIgnoredDomain(entry, hostname));
      } catch { return false; }
    }).flatMap(tab => typeof tab.id === "number" ? [tab.id] : []);
    const existing = await dnr.getSessionRules();
    const legacy = await dnr.getDynamicRules();
    // Remove older browser-wide rules even when paused.
    await dnr.updateDynamicRules({ removeRuleIds: legacy.filter(rule => rule.id >= BLOCKED_ROUTE_RULE_ID_BASE).map(rule => rule.id) });
    const rules: chrome.declarativeNetRequest.Rule[] = [];
    const statuses: typeof blockingStatus = [];
    let regexCount = 0;
    const inactiveReason = !settings.enabled ? "AdCheck is paused."
      : !settings.blockedRoutesEnabled ? "Route blocking is turned off."
      : !settings.blockingHostname ? "Enter a blocking hostname to activate this rule." : "";
    for (const entry of settings.blockedRoutes) {
      const status = {value: entry.value, state: "saved", message: `Waiting: open ${settings.blockingHostname} in a tab to activate.`};
      statuses.push(status);
      if (inactiveReason || !entry.enabled) { status.state = "disabled"; status.message = inactiveReason || "This rule is unchecked."; continue; }
      const value = entry.value.trim();
      const condition: chrome.declarativeNetRequest.RuleCondition = {tabIds, initiatorDomains: [settings.blockingHostname], excludedResourceTypes: ["main_frame"]};
      // Regex only when explicit: /pattern/, /pattern/i, or regex:pattern. Everything
      // else is a DNR urlFilter, so filter syntax such as ||host^ keeps its meaning.
      const slashMatch = value.match(/^\/(.+)\/([a-z]*)$/);
      const regex = slashMatch !== null || value.startsWith("regex:");
      if (regex) {
        const flags = slashMatch ? slashMatch[2] : "i";
        if (!/^(i)?$/.test(flags)) { status.state = "invalid"; status.message = "Only the i flag is supported."; continue; }
        const source = slashMatch ? slashMatch[1] : value.slice("regex:".length);
        let support: chrome.declarativeNetRequest.IsRegexSupportedResult;
        try { support = await dnr.isRegexSupported({regex: source, isCaseSensitive: flags !== "i"}); }
        catch (error) { status.state = "invalid"; status.message = `Chrome could not validate this regex: ${String(error)}`; continue; }
        if (!support.isSupported) { status.state = "invalid"; status.message = `Unsupported Chrome regex: ${support.reason ?? "invalid pattern"}`; continue; }
        condition.regexFilter = source;
        condition.isUrlFilterCaseSensitive = flags !== "i";
      } else { condition.urlFilter = value; condition.isUrlFilterCaseSensitive = false; }
      if (rules.length >= Math.min(dnr.MAX_NUMBER_OF_SESSION_RULES ?? 5000, 1000) || (regex && regexCount >= (dnr.MAX_NUMBER_OF_REGEX_RULES ?? 1000))) {
        status.state = "omitted-due-to-limit"; status.message = "Chrome rule limit reached."; continue;
      }
      if (!tabIds.length) continue;
      if (regex) regexCount++;
      rules.push({id: BLOCKED_ROUTE_RULE_ID_BASE + rules.length, action: {type: "block"}, condition});
      status.state = "installed";
      status.message = !regex && /[()[\]{}+$\\]/.test(value)
        ? "Active as a URL filter. To use it as a regex, write /pattern/i or regex:pattern."
        : `Active on ${settings.blockingHostname}.`;
    }
    try {
      await dnr.updateSessionRules({removeRuleIds: existing.filter(rule => rule.id >= BLOCKED_ROUTE_RULE_ID_BASE).map(rule => rule.id), addRules: rules});
      blockingStatus = statuses;
    } catch (error) {
      blockingStatus = statuses.map(status => status.state === "installed" ? {...status, state: "saved", message: `Installation failed: ${String(error)}`} : status);
    }
  }

  async function readWindowGlobals(
    tabId: number,
    frameId: number | undefined,
    paths: string[]
  ): Promise<AdCheckShared.WindowGlobalReadResult[]> {
    const userScriptsApi = getUserScriptsApi();
    const results: AdCheckShared.WindowGlobalReadResult[] = [];

    for (const rawPath of paths) {
      try {
        const encodedPath = JSON.stringify(rawPath);
        const injectionResult = await userScriptsApi.execute({
          target: typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId },
          injectImmediately: true,
          world: "MAIN",
          js: [{
            code: `(() => {
              const MAX_SERIALIZED_LENGTH = 4000;
              const dotPath = ${encodedPath};

              function safeSerialize(val, depth, seen, indent) {
                if (val === null) return "null";
                if (val === undefined) return "undefined";

                const t = typeof val;
                if (t === "string") return JSON.stringify(val);
                if (t === "number" || t === "boolean") return String(val);
                if (t === "bigint") return String(val) + "n";
                if (t === "symbol") return val.toString();
                if (t === "function") return "[Function: " + ((val && val.name) || "anonymous") + "]";

                if (typeof HTMLElement !== "undefined" && val instanceof HTMLElement) {
                  const tag = val.tagName ? val.tagName.toLowerCase() : "element";
                  const id = val.id ? "#" + val.id : "";
                  const cls = val.className && typeof val.className === "string"
                    ? "." + val.className.split(" ").filter(Boolean).slice(0, 2).join(".")
                    : "";
                  return "[" + tag + id + cls + "]";
                }

                if (typeof Node !== "undefined" && val instanceof Node) {
                  return "[Node: " + val.nodeName + "]";
                }

                if (depth > 3) return Array.isArray(val) ? "[Array]" : "[Object]";

                if (seen.has(val)) return "[Circular]";
                seen.add(val);

                const pad = "  ".repeat(indent + 1);
                const closePad = "  ".repeat(indent);

                try {
                  if (Array.isArray(val)) {
                    if (val.length === 0) return "[]";
                    const items = val.slice(0, 20).map((item) => pad + safeSerialize(item, depth + 1, seen, indent + 1));
                    const suffix = val.length > 20 ? "\\n" + pad + "// ..." + (val.length - 20) + " more items" : "";
                    return "[\\n" + items.join(",\\n") + suffix + "\\n" + closePad + "]";
                  }

                  const obj = val;
                  const allKeys = Object.keys(obj);
                  if (allKeys.length === 0) return "{}";
                  const keys = allKeys.slice(0, 30);
                  const pairs = keys.map((k) => pad + JSON.stringify(k) + ": " + safeSerialize(obj[k], depth + 1, seen, indent + 1));
                  const suffix = allKeys.length > 30 ? "\\n" + pad + "// ..." + (allKeys.length - 30) + " more keys" : "";
                  return "{\\n" + pairs.join(",\\n") + suffix + "\\n" + closePad + "}";
                } catch {
                  return "[Unserializable]";
                }
              }

              function isSafeIdentifier(key) {
                return /^[A-Za-z_$][\\w$]*$/.test(key);
              }

              function resolveFirstSegment(key) {
                if (key === "window" || key === "self" || key === "globalThis") {
                  return window;
                }

                if (key in window) {
                  return window[key];
                }

                if (isSafeIdentifier(key)) {
                  try {
                    return eval(key);
                  } catch {
                    return window[key];
                  }
                }

                return window[key];
              }

              try {
                const normalizedPath = String(dotPath).replace(/^(?:window|self|globalThis)\\./, "");
                const keys = normalizedPath.split(".").filter(Boolean);
                let current = keys.length > 0 ? resolveFirstSegment(keys[0]) : window;

                for (const key of keys.slice(1)) {
                  if (current === null || current === undefined) break;
                  current = current[key];
                }

                const t = current === null ? "null"
                  : current === undefined ? "undefined"
                  : Array.isArray(current) ? "array"
                  : typeof current;

                const serialized = safeSerialize(current, 0, new WeakSet(), 0);
                const value = serialized.length > MAX_SERIALIZED_LENGTH
                  ? serialized.slice(0, MAX_SERIALIZED_LENGTH) + "…[truncated]"
                  : serialized;

                return { path: dotPath, type: t, value, error: undefined };
              } catch (e) {
                return { path: dotPath, type: "error", value: "", error: String(e) };
              }
            })()`,
          }],
        });

        const frameResult = injectionResult?.[0]?.result as AdCheckShared.WindowGlobalReadResult | undefined;
        if (frameResult) {
          results.push(frameResult);
        } else {
          results.push({ path: rawPath, type: "error", value: "", error: "No result from page context." });
        }
      } catch (error: unknown) {
        results.push({
          path: rawPath,
          type: "error",
          value: "",
          error: error instanceof Error ? error.message : "Failed to read window global."
        });
      }
    }

    return results;
  }

  function getUserScriptsApi(): typeof chrome.userScripts {
    const userScriptsApi = (chrome as typeof chrome & {
      userScripts?: typeof chrome.userScripts;
    }).userScripts;

    if (!userScriptsApi || typeof userScriptsApi.execute !== "function") {
      throw new Error(
        "User-provided scripts could not run. Enable Allow User Scripts for AdCheck in Chrome's extension details, then reload the extension."
      );
    }

    return userScriptsApi;
  }

  async function getUserScriptStatus(): Promise<AdCheckShared.UserScriptStatus> {
    const chromeMajorVersion = parseChromeMajorVersion();
    if (await isUserScriptsAvailable()) {
      return {
        available: true,
        chromeMajorVersion,
        message: ""
      };
    }

    if (chromeMajorVersion !== null && chromeMajorVersion >= 138) {
      return {
        available: false,
        chromeMajorVersion,
        message:
          "Window global inspection and inline override scripts require user-script access. Enable Allow User Scripts in AdCheck's extension details and reload the extension."
      };
    }

    return {
      available: false,
      chromeMajorVersion,
      message:
        "Window global inspection and inline override scripts need Chrome userScripts support. Update Chrome or enable Developer mode, then reload AdCheck."
    };
  }

  async function isUserScriptsAvailable(): Promise<boolean> {
    try {
      await getUserScriptsApi().getScripts();
      return true;
    } catch {
      return false;
    }
  }

  function parseChromeMajorVersion(): number | null {
    const match = navigator.userAgent.match(/Chrome\/(\d+)/);
    if (!match) {
      return null;
    }

    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  // Synchronous in-memory transitions cannot interleave across request callbacks.
  // Persistence is batched and serialized per tab; storage never owns live state.
  const notificationTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const storageQueues = new Map<number, Promise<void>>();
  const navigationRequests = new Map<number, string>();
  const tabHosts = new Map<number, string>();

  function clearTabTracking(tabId: number, clearNavigation = true): void {
    const hadState = tabStateCache.delete(tabId);
    if (hadState || storageQueues.has(tabId)) queueStorage(tabId, () => chrome.storage.session.remove(AdCheckShared.tabStateStorageKey(tabId)));
    if (clearNavigation) { navigationRequests.delete(tabId); tabHosts.delete(tabId); }
    clearTimeout(notificationTimers.get(tabId));
    notificationTimers.delete(tabId);
    notifyPending.delete(tabId);
    for (const [key, request] of pendingRequests) {
      if (request.tabId === tabId) pendingRequests.delete(key);
    }
  }

  function trackingEnabled(tabId: number): boolean {
    return settingsCache.current.enabled && settingsCache.current.bundles.length > 0 &&
      !settingsCache.current.ignoredDomains.some(entry => AdCheckShared.matchesIgnoredDomain(entry, tabHosts.get(tabId) ?? ""));
  }

  function queueStorage(tabId: number, operation: () => Promise<void>): void {
    const next = (storageQueues.get(tabId) ?? Promise.resolve()).then(operation).catch(error => {
      console.warn("AdCheck request history could not be saved:", error);
    });
    storageQueues.set(tabId, next);
    void next.then(() => { if (storageQueues.get(tabId) === next) storageQueues.delete(tabId); });
  }

  const notifyPending = new Set<number>();
  function scheduleNotification(tabId: number, matched: boolean): void {
    // Unmatched scripts are retained (so renamed checks can match them later)
    // but do not wake the widget, since they cannot change current results.
    if (matched) notifyPending.add(tabId);
    if (notificationTimers.has(tabId)) return;
    notificationTimers.set(tabId, setTimeout(() => {
      notificationTimers.delete(tabId);
      const notify = notifyPending.delete(tabId);
      if (!trackingEnabled(tabId)) return;
      const state = tabStateCache.get(tabId);
      if (state) {
        const snapshot = {history: [...state.history], activeRequests: [...state.activeRequests], lastUpdatedAt: state.lastUpdatedAt};
        queueStorage(tabId, async () => {
          if (!trackingEnabled(tabId) || !tabStateCache.has(tabId)) return;
          await chrome.storage.session.set({[AdCheckShared.tabStateStorageKey(tabId)]: {version: 1, state: snapshot}});
        });
      }
      if (notify) void notifyTab(tabId);
    }, 100));
  }

  function handleBeforeRequest(details: WebRequestLike): void {
    if (details.tabId < 0) return;
    if (details.type === "main_frame") {
      const previousHost = tabHosts.get(details.tabId);
      if (navigationRequests.get(details.tabId) !== details.requestId) {
        clearTabTracking(details.tabId);
        navigationRequests.set(details.tabId, details.requestId);
        void updateActionBadge(details.tabId, false).catch(() => {});
      }
      let hostname = "";
      try { hostname = new URL(details.url).hostname; } catch { /* Keep empty. */ }
      tabHosts.set(details.tabId, hostname);
      // Install tab-scoped blocking before the new document starts requesting
      // subresources, rather than waiting for tabs.onUpdated.
      const blockingHost = settingsCache.current.blockingHostname;
      if (blockingHost && previousHost !== hostname && (hostname === blockingHost || previousHost === blockingHost)) void syncBlockedRouteRules();
      return;
    }
    // Retain every script (redacted and bounded) so the widget can re-match
    // history when bundle names are edited on an already-loaded page.
    if (details.type !== "script" || !trackingEnabled(details.tabId)) return;
    const matchedChecks = settingsCache.current.bundles.filter(pattern => AdCheckShared.matchesBundle(pattern, details.url, details.type));
    const key = requestKey(details.tabId, details.requestId);
    const previous = pendingRequests.get(key);
    const request: PendingRequest = {
      tabId: details.tabId, requestId: details.requestId, resourceType: details.type,
      startedAt: previous?.startedAt ?? details.timeStamp,
      url: AdCheckShared.redactRequestUrl(details.url),
      matchedChecks: [...new Set([...(previous?.matchedChecks ?? []), ...matchedChecks])]
    };
    pendingRequests.set(key, request);
    const state = getTabState(details.tabId);
    state.activeRequests = state.activeRequests.filter(item => item.requestId !== request.requestId).concat(request);
    state.lastUpdatedAt = Date.now();
    scheduleNotification(details.tabId, request.matchedChecks!.length > 0);
  }

  function finalizeRequest(details: WebRequestLike, status: "completed" | "error"): void {
    const key = requestKey(details.tabId, details.requestId);
    const pending = pendingRequests.get(key);
    if (!pending || !trackingEnabled(details.tabId)) return;
    pendingRequests.delete(key);
    const state = getTabState(details.tabId);
    state.activeRequests = state.activeRequests.filter(item => item.requestId !== details.requestId);
    // Re-match with the full URL in case bundle names changed mid-request.
    const matchedChecks = [...new Set([...(pending.matchedChecks ?? []), ...settingsCache.current.bundles.filter(pattern => AdCheckShared.matchesBundle(pattern, details.url, pending.resourceType))])];
    state.history.push({
      ...pending, url: AdCheckShared.redactRequestUrl(details.url), completedAt: details.timeStamp,
      loadTimeMs: Math.max(0, Math.round(details.timeStamp - pending.startedAt)),
      status, statusCode: details.statusCode, error: details.error, matchedChecks
    });
    trimHistory(state);
    state.lastUpdatedAt = Date.now();
    scheduleNotification(details.tabId, matchedChecks.length > 0);
  }

  // Evict the oldest unmatched scripts first so configured bundles, which often
  // load early, are not pushed out by later third-party scripts.
  function trimHistory(state: NetworkTabState): void {
    while (state.history.length > AdCheckShared.MAX_NETWORK_HISTORY) {
      const index = state.history.findIndex(entry => !entry.matchedChecks?.length);
      state.history.splice(index >= 0 ? index : 0, 1);
    }
  }

  function getTabState(tabId: number): NetworkTabState {
    let state = tabStateCache.get(tabId);
    if (!state) { state = AdCheckShared.createEmptyTabState(); tabStateCache.set(tabId, state); }
    return state;
  }

  async function notifyTab(tabId: number): Promise<void> {
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "NETWORK_ACTIVITY_UPDATED"
      } satisfies RuntimeMessage);
    } catch {
      // Ignore tabs without an active content script.
    }
  }

  function requestKey(tabId: number, requestId: string): string {
    return `${tabId}:${requestId}`;
  }

  async function updateActionBadge(tabId: number, allPass: boolean): Promise<void> {
    await chrome.action.setBadgeText({
      tabId,
      text: allPass ? "✓" : ""
    });

    if (allPass) {
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: "#1f7a40"
      });
    }
  }

  async function syncActionIcons(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    const iconPaths = settingsCache.current.enabled ? ACTION_ICON_PATHS.color : ACTION_ICON_PATHS.gray;

    await chrome.action.setIcon({
      path: iconPaths
    });

    for (const tab of tabs) {
      if (typeof tab.id !== "number") {
        continue;
      }

      await chrome.action.setIcon({
        tabId: tab.id,
        path: iconPaths
      });
    }
  }
})();
