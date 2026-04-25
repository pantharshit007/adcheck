"use strict";
/// <reference path="./types.ts" />
var AdCheckShared;
(function (AdCheckShared) {
    AdCheckShared.STORAGE_KEY = "adcheck-settings";
    AdCheckShared.TAB_STATE_PREFIX = "adcheck-tab-state:";
    AdCheckShared.MAX_NETWORK_HISTORY = 200;
    AdCheckShared.DEFAULT_WAIT_MS = 5000;
    AdCheckShared.DEFAULT_SETTINGS = {
        enabled: false,
        widgetCollapsed: false,
        bundles: ["apstream.js"],
        classNames: ["videoHandler"],
        domIds: ["ad-container"],
        attributes: ["section-id"],
        cookies: ["uid"],
        localStorageKeys: ["adSession"]
    };
    AdCheckShared.SETTINGS_SECTIONS = [
        {
            key: "bundles",
            title: "Bundle or script names",
            description: "Tell AdCheck which ad scripts should load on the page.",
            placeholder: "apstream.js"
        },
        {
            key: "classNames",
            title: "CSS class names",
            description: "Look for page elements that carry these class names.",
            placeholder: "videoHandler"
        },
        {
            key: "domIds",
            title: "Page element IDs",
            description: "Add IDs for ad slots or wrappers you want to jump to.",
            placeholder: "ad-container"
        },
        {
            key: "attributes",
            title: "Attribute names",
            description: "Find values like section IDs or ad unit metadata anywhere in the DOM.",
            placeholder: "section-id"
        },
        {
            key: "cookies",
            title: "Cookie names",
            description: "Check the browser cookies your ad setup depends on.",
            placeholder: "uid"
        },
        {
            key: "localStorageKeys",
            title: "Local storage keys",
            description: "Verify page storage keys such as session or targeting data.",
            placeholder: "adSession"
        }
    ];
    function cloneDefaultSettings() {
        return {
            enabled: AdCheckShared.DEFAULT_SETTINGS.enabled,
            widgetCollapsed: AdCheckShared.DEFAULT_SETTINGS.widgetCollapsed,
            bundles: [...AdCheckShared.DEFAULT_SETTINGS.bundles],
            classNames: [...AdCheckShared.DEFAULT_SETTINGS.classNames],
            domIds: [...AdCheckShared.DEFAULT_SETTINGS.domIds],
            attributes: [...AdCheckShared.DEFAULT_SETTINGS.attributes],
            cookies: [...AdCheckShared.DEFAULT_SETTINGS.cookies],
            localStorageKeys: [...AdCheckShared.DEFAULT_SETTINGS.localStorageKeys]
        };
    }
    AdCheckShared.cloneDefaultSettings = cloneDefaultSettings;
    function mergeSettings(candidate) {
        const defaults = cloneDefaultSettings();
        if (!candidate) {
            return defaults;
        }
        return {
            enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : defaults.enabled,
            widgetCollapsed: typeof candidate.widgetCollapsed === "boolean" ? candidate.widgetCollapsed : defaults.widgetCollapsed,
            bundles: normalizeEntries(candidate.bundles, defaults.bundles),
            classNames: normalizeEntries(candidate.classNames, defaults.classNames),
            domIds: normalizeEntries(candidate.domIds, defaults.domIds),
            attributes: normalizeEntries(candidate.attributes, defaults.attributes),
            cookies: normalizeEntries(candidate.cookies, defaults.cookies),
            localStorageKeys: normalizeEntries(candidate.localStorageKeys, defaults.localStorageKeys)
        };
    }
    AdCheckShared.mergeSettings = mergeSettings;
    function normalizeEntries(value, fallback = []) {
        if (!Array.isArray(value)) {
            return [...fallback];
        }
        const unique = new Set();
        for (const item of value) {
            if (typeof item !== "string") {
                continue;
            }
            const normalized = item.trim();
            if (normalized) {
                unique.add(normalized);
            }
        }
        return Array.from(unique);
    }
    AdCheckShared.normalizeEntries = normalizeEntries;
    function tabStateStorageKey(tabId) {
        return `${AdCheckShared.TAB_STATE_PREFIX}${tabId}`;
    }
    AdCheckShared.tabStateStorageKey = tabStateStorageKey;
    function createEmptyTabState() {
        return {
            history: [],
            activeRequests: [],
            lastUpdatedAt: null
        };
    }
    AdCheckShared.createEmptyTabState = createEmptyTabState;
})(AdCheckShared || (AdCheckShared = {}));
