declare namespace AdCheckShared {
  type CheckStatus = "pending" | "pass" | "fail";

  interface Settings {
    enabled: boolean;
    widgetCollapsed: boolean;
    bundles: string[];
    classNames: string[];
    domIds: string[];
    attributes: string[];
    cookies: string[];
    localStorageKeys: string[];
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

  interface PageCheckSnapshot {
    bundles: BundleCheckResult[];
    classNames: CheckResultBase[];
    domIds: DomCheckResult[];
    attributes: AttributeCheckResult[];
    cookies: StorageCheckResult[];
    localStorageKeys: StorageCheckResult[];
    lastRunAt: number;
  }

  interface RuntimeMessage {
    type: "GET_SETTINGS" | "GET_TAB_NETWORK_STATE" | "REFRESH_TAB_NETWORK_STATE" | "NETWORK_ACTIVITY_UPDATED";
  }
}
