"use strict";
/// <reference path="./shared/types.ts" />
(() => {
    self.importScripts("shared/defaults.js");
    const settingsCache = {
        current: AdCheckShared.cloneDefaultSettings()
    };
    const tabStateCache = new Map();
    const pendingRequests = new Map();
    void initialize();
    chrome.runtime.onInstalled.addListener(() => {
        void ensureSettings();
    });
    chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "sync") {
            return;
        }
        const nextValue = changes[AdCheckShared.STORAGE_KEY]?.newValue;
        if (nextValue) {
            settingsCache.current = AdCheckShared.mergeSettings(nextValue);
        }
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
        tabStateCache.delete(tabId);
        void chrome.storage.session.remove(AdCheckShared.tabStateStorageKey(tabId));
    });
    chrome.webRequest.onBeforeRequest.addListener((details) => {
        void handleBeforeRequest(details);
        return undefined;
    }, { urls: ["http://*/*", "https://*/*"] });
    chrome.webRequest.onCompleted.addListener((details) => {
        void finalizeRequest(details, "completed");
    }, { urls: ["http://*/*", "https://*/*"] });
    chrome.webRequest.onErrorOccurred.addListener((details) => {
        void finalizeRequest(details, "error");
    }, { urls: ["http://*/*", "https://*/*"] });
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        void handleRuntimeMessage(message, sender)
            .then((response) => sendResponse(response))
            .catch((error) => {
            sendResponse({
                ok: false,
                error: error instanceof Error ? error.message : "Unknown error"
            });
        });
        return true;
    });
    async function initialize() {
        settingsCache.current = await ensureSettings();
    }
    async function ensureSettings() {
        const result = await chrome.storage.sync.get(AdCheckShared.STORAGE_KEY);
        const merged = AdCheckShared.mergeSettings(result[AdCheckShared.STORAGE_KEY]);
        if (!result[AdCheckShared.STORAGE_KEY]) {
            await chrome.storage.sync.set({
                [AdCheckShared.STORAGE_KEY]: merged
            });
        }
        settingsCache.current = merged;
        return merged;
    }
    async function handleRuntimeMessage(message, sender) {
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
            default:
                return { ok: false, error: "Unsupported message." };
        }
    }
    async function handleBeforeRequest(details) {
        if (details.tabId < 0) {
            return;
        }
        if (details.type === "main_frame") {
            await resetTabState(details.tabId);
            return;
        }
        if (details.type === "sub_frame") {
            return;
        }
        const key = requestKey(details.tabId, details.requestId);
        const pendingRequest = {
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
    async function finalizeRequest(details, status) {
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
        const entry = {
            url: details.url,
            requestId: details.requestId,
            resourceType: details.type,
            startedAt,
            completedAt: details.timeStamp,
            loadTimeMs,
            status,
            error: details.error
        };
        tabState.history = tabState.history.filter((historyItem) => !(historyItem.requestId === entry.requestId && historyItem.url === entry.url));
        tabState.history.push(entry);
        tabState.history = tabState.history
            .sort((left, right) => left.startedAt - right.startedAt)
            .slice(-AdCheckShared.MAX_NETWORK_HISTORY);
        tabState.lastUpdatedAt = Date.now();
        await persistTabState(details.tabId, tabState);
        await notifyTab(details.tabId);
    }
    async function getTabState(tabId) {
        const cached = tabStateCache.get(tabId);
        if (cached) {
            return cloneTabState(cached);
        }
        const stored = await chrome.storage.session.get(AdCheckShared.tabStateStorageKey(tabId));
        const state = stored[AdCheckShared.tabStateStorageKey(tabId)] ??
            AdCheckShared.createEmptyTabState();
        tabStateCache.set(tabId, cloneTabState(state));
        return cloneTabState(state);
    }
    async function persistTabState(tabId, state) {
        const cloned = cloneTabState(state);
        tabStateCache.set(tabId, cloned);
        await chrome.storage.session.set({
            [AdCheckShared.tabStateStorageKey(tabId)]: cloned
        });
    }
    async function resetTabState(tabId) {
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
        await notifyTab(tabId);
    }
    async function notifyTab(tabId) {
        try {
            await chrome.tabs.sendMessage(tabId, {
                type: "NETWORK_ACTIVITY_UPDATED"
            });
        }
        catch {
            // Ignore tabs without an active content script.
        }
    }
    function requestKey(tabId, requestId) {
        return `${tabId}:${requestId}`;
    }
    function cloneTabState(state) {
        return {
            history: [...state.history],
            activeRequests: [...state.activeRequests],
            lastUpdatedAt: state.lastUpdatedAt
        };
    }
})();
