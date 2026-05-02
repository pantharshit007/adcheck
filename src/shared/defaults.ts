/// <reference path="./types.ts" />

namespace AdCheckShared {
  export const STORAGE_KEY = "adcheck-settings";
  export const SITE_OVERRIDE_STORAGE_KEY = "adcheck-site-overrides";
  export const SITE_PICK_SELECTION_PREFIX = "adcheck-site-pick-selection:";
  export const TAB_STATE_PREFIX = "adcheck-tab-state:";
  export const MAX_NETWORK_HISTORY = 200;
  export const DEFAULT_WAIT_MS = 5000;

  export const DEFAULT_SETTINGS: Settings = {
    enabled: false,
    widgetCollapsed: false,
    widgetSide: "right",
    bundles: ["apInstreamBundle"],
    classNames: [],
    domIds: ["videoWrapperDiv"],
    attributes: ["data-instreamplayermode"],
    cookies: [],
    localStorageKeys: [],
    ignoredDomains: []
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
      placeholder: "data-instreamplayermode"
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
    },
    {
      key: "ignoredDomains",
      title: "Ignored domains",
      description: "Skip AdCheck on matching hostnames. Use example.com for domains or google|github\\.com for regex.",
      placeholder: "example.com or google|github\\.com"
    }
  ] as const;

  export function cloneDefaultSettings(): Settings {
    return {
      enabled: DEFAULT_SETTINGS.enabled,
      widgetCollapsed: DEFAULT_SETTINGS.widgetCollapsed,
      widgetSide: DEFAULT_SETTINGS.widgetSide,
      bundles: [...DEFAULT_SETTINGS.bundles],
      classNames: [...DEFAULT_SETTINGS.classNames],
      domIds: [...DEFAULT_SETTINGS.domIds],
      attributes: [...DEFAULT_SETTINGS.attributes],
      cookies: [...DEFAULT_SETTINGS.cookies],
      localStorageKeys: [...DEFAULT_SETTINGS.localStorageKeys],
      ignoredDomains: [...DEFAULT_SETTINGS.ignoredDomains]
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
      widgetSide: candidate.widgetSide === "left" ? "left" : defaults.widgetSide,
      bundles: normalizeEntries(candidate.bundles, defaults.bundles),
      classNames: normalizeEntries(candidate.classNames, defaults.classNames),
      domIds: normalizeEntries(candidate.domIds, defaults.domIds),
      attributes: normalizeEntries(candidate.attributes, defaults.attributes),
      cookies: normalizeEntries(candidate.cookies, defaults.cookies),
      localStorageKeys: normalizeEntries(candidate.localStorageKeys, defaults.localStorageKeys),
      ignoredDomains: normalizeEntries(candidate.ignoredDomains, defaults.ignoredDomains)
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

  export function normalizeSiteOverrides(value: unknown): SiteOverrideRule[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const overrides: SiteOverrideRule[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const candidate = entry as Partial<SiteOverrideRule>;
      const hostname = typeof candidate.hostname === "string" ? candidate.hostname.trim().toLowerCase() : "";
      const selector = typeof candidate.selector === "string" ? candidate.selector.trim() : "";
      const htmlSnippet = typeof candidate.htmlSnippet === "string" ? candidate.htmlSnippet.trim() : "";
      const placement = normalizePlacement(candidate.placement);
      const enabled = typeof candidate.enabled === "boolean" ? candidate.enabled : true;
      const updatedAt = typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now();

      if (!hostname || !selector || !htmlSnippet) {
        continue;
      }

      overrides.push({
        hostname,
        selector,
        placement,
        htmlSnippet,
        enabled,
        updatedAt
      });
    }

    return overrides.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  export function normalizePlacement(value: unknown): SiteOverridePlacement {
    return value === "beforebegin" || value === "afterbegin" || value === "beforeend" || value === "afterend"
      ? value
      : "afterend";
  }

  export function findSiteOverrideForHostname(
    overrides: SiteOverrideRule[],
    hostname: string
  ): SiteOverrideRule | null {
    const normalizedHostname = hostname.trim().toLowerCase();
    return overrides.find((entry) => entry.hostname === normalizedHostname) ?? null;
  }

  export function sitePickSelectionStorageKey(hostname: string): string {
    return `${SITE_PICK_SELECTION_PREFIX}${hostname.trim().toLowerCase()}`;
  }
}
