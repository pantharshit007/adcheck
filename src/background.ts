/// <reference path="./shared/types.ts" />

(() => {
  self.importScripts("shared/defaults.js");

	type Settings = AdCheckShared.Settings;
	type BlockedRouteEntry = AdCheckShared.BlockedRouteEntry;
	type NetworkTabState = AdCheckShared.NetworkTabState;
  type NetworkHistoryEntry = AdCheckShared.NetworkHistoryEntry;
  type ActiveNetworkRequest = AdCheckShared.ActiveNetworkRequest;
  type RuntimeMessage = AdCheckShared.RuntimeMessage;
  type WebRequestLike = {
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

  void initialize();

  chrome.runtime.onInstalled.addListener(() => {
    void ensureSettings();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "sync") {
      return;
    }

		const nextValue = changes[AdCheckShared.STORAGE_KEY]?.newValue as Partial<Settings> | undefined;
		if (nextValue) {
			settingsCache.current = AdCheckShared.mergeSettings(nextValue);
			void syncBlockedRouteRules();
			void syncActionIcons();
		}
	});

  chrome.tabs.onActivated.addListener(() => {
    void syncActionIcons();
  });

  chrome.tabs.onUpdated.addListener(() => {
    void syncActionIcons();
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    tabStateCache.delete(tabId);
    void chrome.storage.session.remove(AdCheckShared.tabStateStorageKey(tabId));
  });

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      void handleBeforeRequest(details as WebRequestLike);
      return undefined;
    },
    { urls: ["http://*/*", "https://*/*"] }
  );

  chrome.webRequest.onCompleted.addListener(
    (details) => {
      void finalizeRequest(details as WebRequestLike, "completed");
    },
    { urls: ["http://*/*", "https://*/*"] }
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      void finalizeRequest(details as WebRequestLike, "error");
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
		settingsCache.current = await ensureSettings();
		await syncBlockedRouteRules();
		await syncActionIcons();
	}

  async function ensureSettings(): Promise<Settings> {
    const result = await chrome.storage.sync.get(AdCheckShared.STORAGE_KEY);
    const merged = AdCheckShared.mergeSettings(result[AdCheckShared.STORAGE_KEY] as Partial<Settings> | undefined);

    if (!result[AdCheckShared.STORAGE_KEY]) {
      await chrome.storage.sync.set({
        [AdCheckShared.STORAGE_KEY]: merged
      });
    }

		settingsCache.current = merged;
		await syncBlockedRouteRules();
		await syncActionIcons();
		return merged;
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
			await syncBlockedRouteRules();
			return { ok: true };
		case "EXECUTE_SITE_OVERRIDE_INLINE_SCRIPTS": {
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number" || !Array.isArray(message.scriptCodes) || message.scriptCodes.length === 0) {
          return { ok: false, error: "Missing tab or inline script payload." };
        }

        await executeSiteOverrideInlineScripts(tabId, sender.frameId, message.scriptCodes);
        return { ok: true };
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

  async function executeSiteOverrideInlineScripts(
    tabId: number,
    frameId: number | undefined,
    scriptCodes: string[]
  ): Promise<void> {
    const userScriptsApi = getUserScriptsApi();

    if (!userScriptsApi || typeof userScriptsApi.execute !== "function") {
      throw new Error(
        "Inline override script blocks could not run. Markup and direct external script tags may still apply. Enable Allow User Scripts for AdCheck to run inline loader code."
      );
    }

    await userScriptsApi.execute({
      target: typeof frameId === "number" ? { tabId, frameIds: [frameId] } : { tabId },
      injectImmediately: true,
      js: scriptCodes.map((code) => ({ code })),
      world: "USER_SCRIPT"
    });
  }

  async function syncBlockedRouteRules(): Promise<void> {
    if (!chrome.declarativeNetRequest) {
      return;
    }

    const blockedRoutes = settingsCache.current.blockedRoutesEnabled ? settingsCache.current.blockedRoutes : [];
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existingRules
      .filter((rule) => rule.id >= BLOCKED_ROUTE_RULE_ID_BASE && rule.id < BLOCKED_ROUTE_RULE_ID_BASE + 1000)
      .map((rule) => rule.id);
		const limits = getDynamicRuleLimits();
		const addRules: chrome.declarativeNetRequest.Rule[] = [];
		let regexRuleCount = 0;
		let skippedBecauseOfLimit = 0;

		for (const entry of blockedRoutes) {
			const rule = buildBlockedRouteRule(entry, BLOCKED_ROUTE_RULE_ID_BASE + addRules.length);
			if (!rule) {
				continue;
			}

			const isRegexRule = "regexFilter" in rule.condition;
			if (addRules.length >= limits.dynamicRuleLimit || (isRegexRule && regexRuleCount >= limits.regexRuleLimit)) {
				skippedBecauseOfLimit += 1;
				continue;
			}

			if (isRegexRule) {
				regexRuleCount += 1;
			}

			addRules.push(rule);
		}

		try {
			await chrome.declarativeNetRequest.updateDynamicRules({
				removeRuleIds,
				addRules
			});
		} catch (error: unknown) {
			console.warn(
				`AdCheck blocked route rules failed to sync: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}

		if (skippedBecauseOfLimit > 0) {
			console.warn(
				`AdCheck blocked route rules truncated to ${addRules.length} rules due to Chrome DNR limits.`,
			);
		}
  }

	function getDynamicRuleLimits(): { dynamicRuleLimit: number; regexRuleLimit: number } {
		const dnr = chrome.declarativeNetRequest as typeof chrome.declarativeNetRequest & {
			MAX_NUMBER_OF_DYNAMIC_RULES?: number;
			MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES?: number;
			MAX_NUMBER_OF_REGEX_RULES?: number;
		};

		return {
			dynamicRuleLimit: dnr.MAX_NUMBER_OF_DYNAMIC_RULES ?? dnr.MAX_NUMBER_OF_UNSAFE_DYNAMIC_RULES ?? 5000,
			regexRuleLimit: dnr.MAX_NUMBER_OF_REGEX_RULES ?? 1000,
		};
	}

  function buildBlockedRouteRule(entry: BlockedRouteEntry, id: number): chrome.declarativeNetRequest.Rule | null {
    const value = entry.value.trim();
    if (!value || !entry.enabled) {
      return null;
    }

    const regexFilter = isBlockedRouteRegex(value) ? buildBlockedRouteRegex(value) : null;
    return {
      id,
      action: { type: "block" },
      condition: regexFilter
        ? {
            regexFilter,
            isUrlFilterCaseSensitive: false,
          }
        : {
            urlFilter: value,
            isUrlFilterCaseSensitive: false,
          }
    };
  }

  function isBlockedRouteRegex(value: string): boolean {
    const trimmed = value.trim();
    return (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) || AdCheckShared.looksLikeRegexPattern(trimmed);
  }

  function buildBlockedRouteRegex(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const source = trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0
      ? trimmed.slice(1, trimmed.lastIndexOf("/"))
      : trimmed;

    try {
      new RegExp(source);
      return source;
    } catch {
      return null;
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

              try {
                const keys = String(dotPath).replace(/^window\\./, "").split(".");
                let current = window;
                for (const key of keys) {
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
        "Inline override script blocks could not run. Markup and direct external script tags may still apply. Enable Allow User Scripts for AdCheck to run inline loader code."
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
          "This override includes inline script blocks. The page markup and any direct external script tags can still apply, but the inline loader code will not run until you enable Allow User Scripts in AdCheck's extension details and reload the extension."
      };
    }

    return {
      available: false,
      chromeMajorVersion,
      message:
        "This override includes inline script blocks. The page markup and any direct external script tags can still apply, but the inline loader code needs Chrome userScripts support. Update Chrome or enable Developer mode, then reload AdCheck."
    };
  }

  async function isUserScriptsAvailable(): Promise<boolean> {
    try {
      await chrome.userScripts.getScripts();
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

  async function handleBeforeRequest(details: WebRequestLike): Promise<void> {
    if (details.tabId < 0) {
      return;
    }

    if (details.type === "main_frame") {
      await updateActionBadge(details.tabId, false);
      await resetTabState(details.tabId);
      return;
    }

    if (details.type === "sub_frame") {
      return;
    }

    const key = requestKey(details.tabId, details.requestId);
    const pendingRequest: PendingRequest = {
      tabId: details.tabId,
      requestId: details.requestId,
      resourceType: details.type,
      startedAt: details.timeStamp,
      url: details.url
    };

    pendingRequests.set(key, pendingRequest);

    const tabState = await getTabState(details.tabId);
    tabState.activeRequests = tabState.activeRequests
      .filter((request) => request.requestId !== details.requestId)
      .concat({
        url: pendingRequest.url,
        requestId: pendingRequest.requestId,
        resourceType: pendingRequest.resourceType,
        startedAt: pendingRequest.startedAt
      });
    tabState.lastUpdatedAt = Date.now();

    await persistTabState(details.tabId, tabState);
  }

  async function finalizeRequest(details: WebRequestLike, status: "completed" | "error"): Promise<void> {
    if (details.tabId < 0 || details.type === "main_frame" || details.type === "sub_frame") {
      return;
    }

    const key = requestKey(details.tabId, details.requestId);
    const pendingRequest = pendingRequests.get(key);
    const startedAt = pendingRequest?.startedAt ?? details.timeStamp;
    const loadTimeMs = Math.max(0, Math.round(details.timeStamp - startedAt));

    pendingRequests.delete(key);

    const tabState = await getTabState(details.tabId);
    tabState.activeRequests = tabState.activeRequests.filter((request) => request.requestId !== details.requestId);

    const entry: NetworkHistoryEntry = {
      url: details.url,
      requestId: details.requestId,
      resourceType: details.type,
      startedAt,
      completedAt: details.timeStamp,
      loadTimeMs,
      status,
      error: details.error
    };

    tabState.history = tabState.history.filter(
      (historyItem) => !(historyItem.requestId === entry.requestId && historyItem.url === entry.url)
    );
    tabState.history.push(entry);
    tabState.history = tabState.history
      .sort((left, right) => left.startedAt - right.startedAt)
      .slice(-AdCheckShared.MAX_NETWORK_HISTORY);
    tabState.lastUpdatedAt = Date.now();

    await persistTabState(details.tabId, tabState);
    await notifyTab(details.tabId);
  }

  async function getTabState(tabId: number): Promise<NetworkTabState> {
    const cached = tabStateCache.get(tabId);
    if (cached) {
      return cloneTabState(cached);
    }

    const stored = await chrome.storage.session.get(AdCheckShared.tabStateStorageKey(tabId));
    const state = (stored[AdCheckShared.tabStateStorageKey(tabId)] as NetworkTabState | undefined) ??
      AdCheckShared.createEmptyTabState();

    tabStateCache.set(tabId, cloneTabState(state));
    return cloneTabState(state);
  }

  async function persistTabState(tabId: number, state: NetworkTabState): Promise<void> {
    const cloned = cloneTabState(state);
    tabStateCache.set(tabId, cloned);
    await chrome.storage.session.set({
      [AdCheckShared.tabStateStorageKey(tabId)]: cloned
    });
  }

  async function resetTabState(tabId: number): Promise<void> {
    const emptyState = AdCheckShared.createEmptyTabState();
    tabStateCache.set(tabId, emptyState);

    for (const [key, request] of pendingRequests.entries()) {
      if (request.tabId === tabId) {
        pendingRequests.delete(key);
      }
    }

    await chrome.storage.session.set({
      [AdCheckShared.tabStateStorageKey(tabId)]: emptyState
    });
    await updateActionBadge(tabId, false);
    await notifyTab(tabId);
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

  function cloneTabState(state: NetworkTabState): NetworkTabState {
    return {
      history: [...state.history],
      activeRequests: [...state.activeRequests],
      lastUpdatedAt: state.lastUpdatedAt
    };
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
