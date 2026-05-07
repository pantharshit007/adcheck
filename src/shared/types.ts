declare namespace AdCheckShared {
  type CheckStatus = "pending" | "pass" | "fail";
  type SiteOverridePlacement = "beforebegin" | "afterbegin" | "beforeend" | "afterend";

  interface SiteOverrideRule {
    hostname: string;
    selector: string;
    placement: SiteOverridePlacement;
    htmlSnippet: string;
    enabled: boolean;
    updatedAt: number;
  }

  interface SitePickerSelection {
    hostname: string;
    selector: string;
    tagName: string;
    dimensionsLabel: string;
    updatedAt: number;
  }

  interface UserScriptStatus {
    available: boolean;
    chromeMajorVersion: number | null;
    message: string;
  }

  interface WindowGlobalEntry {
    path: string;
    awaitBundle: string;
  }

  interface Settings {
    enabled: boolean;
    widgetCollapsed: boolean;
    widgetSide: "left" | "right";
    bundles: string[];
    classNames: string[];
    domIds: string[];
    attributes: string[];
    cookies: string[];
    localStorageKeys: string[];
    ignoredDomains: string[];
    windowGlobals: WindowGlobalEntry[];
  }

  interface NetworkHistoryEntry {
    url: string;
    requestId: string;
    resourceType: string;
    startedAt: number;
    completedAt: number;
    loadTimeMs: number | null;
    status: "completed" | "error";
    error?: string;
  }

  interface ActiveNetworkRequest {
    url: string;
    requestId: string;
    resourceType: string;
    startedAt: number;
  }

  interface NetworkTabState {
    history: NetworkHistoryEntry[];
    activeRequests: ActiveNetworkRequest[];
    lastUpdatedAt: number | null;
  }

  interface CheckResultBase {
    key: string;
    label: string;
    status: CheckStatus;
    explanation: string;
    detail: string;
    detailIsHtml?: boolean;
    failureMessage?: string;
  }

  interface BundleCheckResult extends CheckResultBase {
    matchedUrl?: string;
    loadTimeMs?: number | null;
  }

  interface DomCheckResult extends CheckResultBase {
    targetId: string;
    found: boolean;
  }

  interface AttributeValueSummary {
    value: string;
    count: number;
  }

  interface AttributeCheckResult extends CheckResultBase {
    attributeName: string;
    values: AttributeValueSummary[];
  }

  interface StorageCheckResult extends CheckResultBase {
    storageKind: "cookie" | "localStorage";
    valuePreview?: string;
  }

  interface WindowGlobalCheckResult extends CheckResultBase {
    path: string;
    rawValue: string;
    valueType: string;
    isLargeObject: boolean;
  }

  interface PageCheckSnapshot {
    bundles: BundleCheckResult[];
    classNames: CheckResultBase[];
    domIds: DomCheckResult[];
    attributes: AttributeCheckResult[];
    cookies: StorageCheckResult[];
    localStorageKeys: StorageCheckResult[];
    windowGlobals: WindowGlobalCheckResult[];
    lastRunAt: number;
  }

  interface WindowGlobalReadResult {
    path: string;
    type: string;
    value: string;
    error?: string;
  }

  interface RuntimeMessage {
    type:
      | "GET_SETTINGS"
      | "GET_TAB_NETWORK_STATE"
      | "REFRESH_TAB_NETWORK_STATE"
      | "GET_USER_SCRIPT_STATUS"
      | "NETWORK_ACTIVITY_UPDATED"
      | "SET_ACTION_SUCCESS_STATE"
      | "SYNC_ACTION_STATE"
      | "START_SITE_PICKER"
      | "CANCEL_SITE_PICKER"
      | "EXECUTE_SITE_OVERRIDE_INLINE_SCRIPTS"
      | "READ_WINDOW_GLOBALS";
    allPass?: boolean;
    scriptCodes?: string[];
    windowGlobalPaths?: string[];
  }
}
