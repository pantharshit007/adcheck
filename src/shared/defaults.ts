/// <reference path="./types.ts" />

namespace AdCheckShared {
  export const STORAGE_KEY = "adcheck-settings";
  export const TAB_STATE_PREFIX = "adcheck-tab-state:";
  export const MAX_NETWORK_HISTORY = 200;
  export const DEFAULT_WAIT_MS = 5000;

  export const DEFAULT_SETTINGS: Settings = {
    enabled: false,
    widgetCollapsed: false,
    bundles: ["apInstreamBundle"],
    classNames: [],
    domIds: ["videoWrapperDiv"],
    attributes: ["section-id"],
    cookies: [],
    localStorageKeys: []
  };

  export const SETTINGS_SECTIONS = [
    {
      key: "bundles",
      title: "Bundle or script names",
      description: "Tell AdCheck which ad scripts should load on the page.",
      placeholder: "apInstreamBundle"
    },
    {
      key: "domIds",
      title: "Page element IDs",
      description: "Add IDs for ad slots or wrappers you want to jump to.",
      placeholder: "videoWrapperDiv"
    },
    {
      key: "classNames",
      title: "CSS class names",
      description: "Look for page elements that carry these class names.",
      placeholder: "videoHandler"
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
  ] as const;

  export function cloneDefaultSettings(): Settings {
    return {
      enabled: DEFAULT_SETTINGS.enabled,
      widgetCollapsed: DEFAULT_SETTINGS.widgetCollapsed,
      bundles: [...DEFAULT_SETTINGS.bundles],
      classNames: [...DEFAULT_SETTINGS.classNames],
      domIds: [...DEFAULT_SETTINGS.domIds],
      attributes: [...DEFAULT_SETTINGS.attributes],
      cookies: [...DEFAULT_SETTINGS.cookies],
      localStorageKeys: [...DEFAULT_SETTINGS.localStorageKeys]
    };
  }

  export function mergeSettings(candidate?: Partial<Settings> | null): Settings {
    const defaults = cloneDefaultSettings();
    if (!candidate) {
      return defaults;
    }

    return {
      enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : defaults.enabled,
      widgetCollapsed:
        typeof candidate.widgetCollapsed === "boolean" ? candidate.widgetCollapsed : defaults.widgetCollapsed,
      bundles: normalizeEntries(candidate.bundles, defaults.bundles),
      classNames: normalizeEntries(candidate.classNames, defaults.classNames),
      domIds: normalizeEntries(candidate.domIds, defaults.domIds),
      attributes: normalizeEntries(candidate.attributes, defaults.attributes),
      cookies: normalizeEntries(candidate.cookies, defaults.cookies),
      localStorageKeys: normalizeEntries(candidate.localStorageKeys, defaults.localStorageKeys)
    };
  }

  export function normalizeEntries(value: unknown, fallback: string[] = []): string[] {
    if (!Array.isArray(value)) {
      return [...fallback];
    }

    const unique = new Set<string>();
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

  export function tabStateStorageKey(tabId: number): string {
    return `${TAB_STATE_PREFIX}${tabId}`;
  }

  export function createEmptyTabState(): NetworkTabState {
    return {
      history: [],
      activeRequests: [],
      lastUpdatedAt: null
    };
  }
}
