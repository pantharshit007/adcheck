/// <reference path="./shared/types.ts" />

(() => {
  self.importScripts("shared/defaults.js");

  type Settings = AdCheckShared.Settings;
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

  const settingsCache: { current: Settings } = {
    current: AdCheckShared.cloneDefaultSettings()
  };

  const tabStateCache = new Map<number, NetworkTabState>();
  const pendingRequests = new Map<string, PendingRequest>();

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
    }
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
    return merged;
  }

  async function handleRuntimeMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
    switch (message.type) {
      case "GET_SETTINGS":
        return {
          ok: true,
          settings: await ensureSettings()
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
      default:
        return { ok: false, error: "Unsupported message." };
    }
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
})();
