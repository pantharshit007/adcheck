/// <reference path="./shared/types.ts" />
/// <reference path="./shared/build-info.ts" />

(() => {
	type Settings = AdCheckShared.Settings;
	type NetworkTabState = AdCheckShared.NetworkTabState;
	type PageCheckSnapshot = AdCheckShared.PageCheckSnapshot;
	type CheckResultBase = AdCheckShared.CheckResultBase;
	type BundleCheckResult = AdCheckShared.BundleCheckResult;
	type DomCheckResult = AdCheckShared.DomCheckResult;
	type AttributeCheckResult = AdCheckShared.AttributeCheckResult;
	type StorageCheckResult = AdCheckShared.StorageCheckResult;
	type WindowGlobalCheckResult = AdCheckShared.WindowGlobalCheckResult;
	type RuntimeMessage = AdCheckShared.RuntimeMessage;
	type SiteOverrideRule = AdCheckShared.SiteOverrideRule;
	type SitePickerSelection = AdCheckShared.SitePickerSelection;
	type PreparedSiteOverride = {
		inlineScriptCodes: string[];
		nodes: Node[];
	};

	const pageWindow = window as Window & {
		__ADCHECK_BOOTSTRAPPED__?: boolean;
	};

	const ROOT_ID = "adcheck-root";
	const HIGHLIGHT_CLASS = "adcheck-target-highlight";
	const PICKER_OVERLAY_ID = "adcheck-picker-overlay";
	const PICKER_LABEL_ID = "adcheck-picker-label";
	const APPLIED_OVERRIDE_ATTRIBUTE = "data-adcheck-site-override";
	const HELP_COPY = {
		bundles: "Checks whether the ad script made a network request on this page.",
		classNames: "Looks through the page for elements using this CSS class name.",
		domIds: "Checks whether this page element ID exists and lets you jump to it.",
		attributes: "Finds every value used for this attribute anywhere in the page markup.",
		cookies: "Verifies whether this browser cookie is available to the page.",
		localStorageKeys: "Checks whether this page stored the key in local storage.",
		windowGlobals: "Reads a value from the page's window object using dot-path access.",
	} as const;

	const state: {
		settings: Settings;
		snapshot: PageCheckSnapshot;
		networkState: NetworkTabState;
		deadlineAt: number | null;
		root: HTMLDivElement | null;
		deadlineHandle: number | null;
		pollHandle: number | null;
		rowHints: Record<string, string>;
		lastRenderSignature: string;
		activeSiteOverride: SiteOverrideRule | null;
		siteOverrideObserver: MutationObserver | null;
		pickerActive: boolean;
		pickerHoveredElement: Element | null;
		pickerMoveHandler: ((event: MouseEvent) => void) | null;
		pickerClickHandler: ((event: MouseEvent) => void) | null;
		pickerKeyHandler: ((event: KeyboardEvent) => void) | null;
		infoTooltipEl: HTMLDivElement | null;
		infoTooltipTarget: HTMLButtonElement | null;
		infoTooltipRaf: number | null;
		infoTooltipHideTimeout: number | null;
	} = {
		settings: AdCheckShared.cloneDefaultSettings(),
		snapshot: createEmptySnapshot(),
		networkState: AdCheckShared.createEmptyTabState(),
		deadlineAt: null,
		root: null,
		deadlineHandle: null,
		pollHandle: null,
		rowHints: {},
		lastRenderSignature: "",
		activeSiteOverride: null,
		siteOverrideObserver: null,
		pickerActive: false,
		pickerHoveredElement: null,
		pickerMoveHandler: null,
		pickerClickHandler: null,
		pickerKeyHandler: null,
		infoTooltipEl: null,
		infoTooltipTarget: null,
		infoTooltipRaf: null,
		infoTooltipHideTimeout: null,
	};

	if (!pageWindow.__ADCHECK_BOOTSTRAPPED__) {
		pageWindow.__ADCHECK_BOOTSTRAPPED__ = true;
		void bootstrap();
	}

	async function bootstrap(): Promise<void> {
		await syncSiteOverride();
		await applySettings(await loadSettings());

		chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
			if (message.type === "NETWORK_ACTIVITY_UPDATED") {
				void syncNetworkAndRefresh(false);
			}

			if (message.type === "START_SITE_PICKER") {
				void startSitePicker();
			}

			if (message.type === "CANCEL_SITE_PICKER") {
				stopSitePicker();
			}

			return undefined;
		});

		chrome.storage.onChanged.addListener((changes, areaName) => {
			if (areaName === "sync" && changes[AdCheckShared.STORAGE_KEY]) {
				const merged = AdCheckShared.mergeSettings(
					changes[AdCheckShared.STORAGE_KEY].newValue as Partial<Settings>,
				);
				void applySettings(merged);
			}

			if (areaName === "local" && changes[AdCheckShared.SITE_OVERRIDE_STORAGE_KEY]) {
				void syncSiteOverride();
			}
		});
	}

	async function syncSiteOverride(): Promise<void> {
		const overrides = await loadSiteOverrides();
		const nextOverride = AdCheckShared.findSiteOverrideForHostname(
			overrides,
			window.location.hostname,
		);

		if (!nextOverride || !nextOverride.enabled) {
			teardownSiteOverride();
			return;
		}

		state.activeSiteOverride = nextOverride;
		applySiteOverrideSoon();
	}

	function applySiteOverrideSoon(): void {
		if (!state.activeSiteOverride) {
			return;
		}

		if (tryApplySiteOverride(state.activeSiteOverride)) {
			stopSiteOverrideObserver();
			return;
		}

		if (state.siteOverrideObserver) {
			return;
		}

		state.siteOverrideObserver = new MutationObserver(() => {
			if (!state.activeSiteOverride) {
				return;
			}

			if (tryApplySiteOverride(state.activeSiteOverride)) {
				stopSiteOverrideObserver();
			}
		});
		state.siteOverrideObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	function tryApplySiteOverride(rule: SiteOverrideRule): boolean {
		return applySelectorOverride(rule);
	}

	function applySelectorOverride(rule: SiteOverrideRule): boolean {
		const target = document.querySelector(rule.selector);
		if (!(target instanceof Element)) {
			return false;
		}

		if (document.querySelector(`[${APPLIED_OVERRIDE_ATTRIBUTE}="${cssEscape(rule.hostname)}"]`)) {
			return true;
		}

		const preparedOverride = buildInjectedNodes(rule.htmlSnippet);
		if (preparedOverride.nodes.length > 0) {
			insertNodesAroundTarget(target, preparedOverride.nodes, rule.placement);
		}

		if (preparedOverride.inlineScriptCodes.length > 0) {
			void executeInlineOverrideScripts(preparedOverride.inlineScriptCodes);
		}

		if (preparedOverride.nodes.length === 0 && preparedOverride.inlineScriptCodes.length === 0) {
			return true;
		}

		target.setAttribute(APPLIED_OVERRIDE_ATTRIBUTE, rule.hostname);
		return true;
	}

	function buildInjectedNodes(htmlSnippet: string): PreparedSiteOverride {
		const template = document.createElement("template");
		template.innerHTML = htmlSnippet.trim();
		const preparedOverride: PreparedSiteOverride = {
			inlineScriptCodes: [],
			nodes: [],
		};

		for (const node of Array.from(template.content.childNodes)) {
			const materializedNode = materializeNode(node, preparedOverride);
			if (materializedNode) {
				preparedOverride.nodes.push(materializedNode);
			}
		}

		return preparedOverride;
	}

	function materializeNode(node: Node, preparedOverride: PreparedSiteOverride): Node | null {
		if (node.nodeType === Node.TEXT_NODE) {
			return document.createTextNode(node.textContent ?? "");
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			return null;
		}

		const source = node as HTMLElement;
		if (source.tagName.toLowerCase() === "script") {
			const sourceScript = source as HTMLScriptElement;
			if (!sourceScript.src) {
				const inlineCode = sourceScript.textContent?.trim() ?? "";
				if (inlineCode) {
					preparedOverride.inlineScriptCodes.push(inlineCode);
				}
				return null;
			}

			const script = document.createElement("script");
			for (const attribute of Array.from(source.attributes)) {
				script.setAttribute(attribute.name, attribute.value);
			}
			return script;
		}

		const clone = document.createElement(source.tagName);
		for (const attribute of Array.from(source.attributes)) {
			clone.setAttribute(attribute.name, attribute.value);
		}
		clone.setAttribute(APPLIED_OVERRIDE_ATTRIBUTE, window.location.hostname.toLowerCase());
		for (const child of Array.from(source.childNodes)) {
			const materializedChild = materializeNode(child, preparedOverride);
			if (materializedChild) {
				clone.appendChild(materializedChild);
			}
		}
		return clone;
	}

	async function executeInlineOverrideScripts(scriptCodes: string[]): Promise<void> {
		const response = await sendMessage<{ ok: boolean; error?: string }>({
			type: "EXECUTE_SITE_OVERRIDE_INLINE_SCRIPTS",
			scriptCodes,
		});

		if (response?.ok === false && response.error) {
			console.warn(`AdCheck site override: ${response.error}`);
		}
	}

	function insertNodesAroundTarget(
		target: Element,
		nodes: Node[],
		placement: AdCheckShared.SiteOverridePlacement,
	): void {
		if (placement === "beforebegin" || placement === "afterend") {
			const parent = target.parentNode;
			if (!parent) {
				return;
			}

			if (placement === "beforebegin") {
				for (const node of nodes) {
					parent.insertBefore(node, target);
				}
				return;
			}

			let reference: ChildNode | null = target.nextSibling;
			for (const node of nodes) {
				parent.insertBefore(node, reference);
			}
			return;
		}

		if (placement === "afterbegin") {
			let reference: ChildNode | null = target.firstChild;
			for (const node of nodes) {
				target.insertBefore(node, reference);
			}
			return;
		}

		for (const node of nodes) {
			target.appendChild(node);
		}
	}

	function teardownSiteOverride(): void {
		state.activeSiteOverride = null;
		stopSiteOverrideObserver();
	}

	function stopSiteOverrideObserver(): void {
		state.siteOverrideObserver?.disconnect();
		state.siteOverrideObserver = null;
	}

	async function startSitePicker(): Promise<void> {
		stopSitePicker();
		state.pickerActive = true;
		ensurePickerOverlay();

		state.pickerMoveHandler = (event: MouseEvent) => {
			const candidate = findPickableElement(event.target);
			if (!candidate) {
				return;
			}

			state.pickerHoveredElement = candidate;
			updatePickerOverlay(candidate);
		};

		state.pickerClickHandler = (event: MouseEvent) => {
			const candidate = findPickableElement(event.target);
			if (!candidate) {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			void persistPickedSelection(candidate);
			stopSitePicker();
		};

		state.pickerKeyHandler = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				stopSitePicker();
			}
		};

		document.addEventListener("mousemove", state.pickerMoveHandler, true);
		document.addEventListener("click", state.pickerClickHandler, true);
		document.addEventListener("keydown", state.pickerKeyHandler, true);
	}

	function stopSitePicker(): void {
		if (state.pickerMoveHandler) {
			document.removeEventListener("mousemove", state.pickerMoveHandler, true);
		}
		if (state.pickerClickHandler) {
			document.removeEventListener("click", state.pickerClickHandler, true);
		}
		if (state.pickerKeyHandler) {
			document.removeEventListener("keydown", state.pickerKeyHandler, true);
		}

		state.pickerActive = false;
		state.pickerHoveredElement = null;
		state.pickerMoveHandler = null;
		state.pickerClickHandler = null;
		state.pickerKeyHandler = null;
		removePickerOverlay();
	}

	function ensurePickerOverlay(): void {
		if (document.getElementById(PICKER_OVERLAY_ID)) {
			return;
		}

		const overlay = document.createElement("div");
		overlay.id = PICKER_OVERLAY_ID;
		overlay.setAttribute(
			"style",
			[
				"position:fixed",
				"left:0",
				"top:0",
				"width:0",
				"height:0",
				"pointer-events:none",
				"border:2px solid #c0392b",
				"background:rgba(192, 57, 43, 0.12)",
				"z-index:2147483646",
				"box-sizing:border-box",
			].join(";"),
		);

		const label = document.createElement("div");
		label.id = PICKER_LABEL_ID;
		label.setAttribute(
			"style",
			[
				"position:absolute",
				"top:-28px",
				"left:0",
				"padding:4px 8px",
				"border-radius:999px",
				"background:#c0392b",
				"color:#fff",
				"font:12px/1.2 sans-serif",
				"white-space:nowrap",
			].join(";"),
		);
		overlay.appendChild(label);
		document.documentElement.appendChild(overlay);
	}

	function updatePickerOverlay(element: Element): void {
		const overlay = document.getElementById(PICKER_OVERLAY_ID) as HTMLDivElement | null;
		const label = document.getElementById(PICKER_LABEL_ID) as HTMLDivElement | null;
		if (!overlay || !label) {
			return;
		}

		const rect = element.getBoundingClientRect();
		overlay.style.left = `${rect.left}px`;
		overlay.style.top = `${rect.top}px`;
		overlay.style.width = `${rect.width}px`;
		overlay.style.height = `${rect.height}px`;
		label.textContent = `${element.tagName.toLowerCase()} ${Math.round(rect.width)}x${Math.round(rect.height)}`;
	}

	function removePickerOverlay(): void {
		document.getElementById(PICKER_OVERLAY_ID)?.remove();
	}

	function findPickableElement(candidate: EventTarget | null): Element | null {
		if (!(candidate instanceof Element)) {
			return null;
		}

		if (candidate.closest(`#${ROOT_ID}`) || candidate.closest(`#${PICKER_OVERLAY_ID}`)) {
			return null;
		}

		return candidate;
	}

	async function persistPickedSelection(element: Element): Promise<void> {
		const selector = buildSelector(element);
		const rect = element.getBoundingClientRect();
		const selection: SitePickerSelection = {
			hostname: window.location.hostname.toLowerCase(),
			selector,
			tagName: element.tagName.toLowerCase(),
			dimensionsLabel: `${Math.round(rect.width)} x ${Math.round(rect.height)}`,
			updatedAt: Date.now(),
		};

		await chrome.storage.local.set({
			[AdCheckShared.sitePickSelectionStorageKey(selection.hostname)]: selection,
		});
	}

	async function applySettings(nextSettings: Settings): Promise<void> {
		state.settings = nextSettings;

		if (!nextSettings.enabled || shouldIgnoreCurrentPage(nextSettings)) {
			await updateActionSuccessState(false);
			teardownWidget();
			return;
		}

		ensureWidget();
		await runChecks(true);
	}

	async function runChecks(resetDeadline: boolean): Promise<void> {
		if (!state.settings.enabled || shouldIgnoreCurrentPage(state.settings)) {
			return;
		}

		if (resetDeadline) {
			stopPolling();
		}

		if (resetDeadline) {
			state.deadlineAt = Date.now() + AdCheckShared.DEFAULT_WAIT_MS;
			scheduleDeadlineRender();
		}

		state.networkState = await getNetworkState(
			resetDeadline ? "REFRESH_TAB_NETWORK_STATE" : "GET_TAB_NETWORK_STATE",
		);
		state.snapshot = buildSnapshot();
		if (state.settings.windowGlobals.length > 0) {
			state.snapshot.windowGlobals = await buildWindowGlobalResults();
		}
		renderWidget();

		syncPollingState();
	}

	async function syncNetworkAndRefresh(resetDeadline: boolean): Promise<void> {
		if (!state.settings.enabled || shouldIgnoreCurrentPage(state.settings)) {
			return;
		}

		if (!resetDeadline && !hasPendingChecks()) {
			return;
		}

		state.networkState = await getNetworkState(
			resetDeadline ? "REFRESH_TAB_NETWORK_STATE" : "GET_TAB_NETWORK_STATE",
		);
		state.snapshot = buildSnapshot();
		if (state.settings.windowGlobals.length > 0) {
			state.snapshot.windowGlobals = await buildWindowGlobalResults();
		}
		renderWidget();

		syncPollingState();
	}

	function buildSnapshot(): PageCheckSnapshot {
		return {
			bundles: buildBundleResults(),
			classNames: buildClassResults(),
			domIds: buildDomResults(),
			attributes: buildAttributeResults(),
			cookies: buildCookieResults(),
			localStorageKeys: buildLocalStorageResults(),
			windowGlobals: [],
			lastRunAt: Date.now(),
		};
	}

	async function buildWindowGlobalResults(): Promise<WindowGlobalCheckResult[]> {
		const entries = state.settings.windowGlobals;
		if (entries.length === 0) {
			return [];
		}

		const results: WindowGlobalCheckResult[] = [];
		const pathsToRead: string[] = [];
		const pendingIndices: number[] = [];

		for (let i = 0; i < entries.length; i++) {
			const entry = entries[i];

			if (entry.awaitBundle) {
				const bundlePassed = state.snapshot.bundles.some(
					(bundle) =>
						bundle.label.toLowerCase() === entry.awaitBundle.toLowerCase() &&
						bundle.status === "pass",
				);

				if (!bundlePassed) {
					results.push({
						key: `windowGlobal:${entry.path}`,
						label: entry.path,
						status: "pending",
						explanation: HELP_COPY.windowGlobals,
						detail: `Waiting for bundle "${entry.awaitBundle}" to load before reading this value.`,
						path: entry.path,
						rawValue: "",
						valueType: "pending",
						isLargeObject: false,
					});
					continue;
				}
			}

			pathsToRead.push(entry.path);
			pendingIndices.push(i);
			results.push(null as unknown as WindowGlobalCheckResult);
		}

		if (pathsToRead.length > 0) {
			const response = await sendMessage<{
				ok: boolean;
				results?: AdCheckShared.WindowGlobalReadResult[];
				error?: string;
			}>({
				type: "READ_WINDOW_GLOBALS",
				windowGlobalPaths: pathsToRead,
			});

			const readResults = response?.results ?? [];

			for (let j = 0; j < pendingIndices.length; j++) {
				const entryIndex = pendingIndices[j];
				const entry = entries[entryIndex];
				const read = readResults[j];

				if (!read || read.error) {
					results[entryIndex] = {
						key: `windowGlobal:${entry.path}`,
						label: entry.path,
						status: hasTimedOut() ? "fail" : "pending",
						explanation: HELP_COPY.windowGlobals,
						detail: read?.error ?? "Could not read this window property.",
						failureMessage: hasTimedOut()
							? (read?.error ?? "Failed to read window property.")
							: undefined,
						path: entry.path,
						rawValue: "",
						valueType: "error",
						isLargeObject: false,
					};
					continue;
				}

				if (read.type === "undefined" || read.type === "null") {
					results[entryIndex] = {
						key: `windowGlobal:${entry.path}`,
						label: entry.path,
						status: hasTimedOut() ? "fail" : "pending",
						explanation: HELP_COPY.windowGlobals,
						detail: hasTimedOut()
							? `Value is ${read.type}. The property may not exist or has not been set yet.`
							: `Value is currently ${read.type}. Waiting to see if it gets set.`,
						failureMessage: hasTimedOut()
							? `Value is ${read.type} — property not found on window.`
							: undefined,
						path: entry.path,
						rawValue: read.type,
						valueType: read.type,
						isLargeObject: false,
					};
					continue;
				}

				const isLarge = read.value.length > 120;
				results[entryIndex] = {
					key: `windowGlobal:${entry.path}`,
					label: entry.path,
					status: "pass",
					explanation: HELP_COPY.windowGlobals,
					detail: read.value,
					detailIsHtml: true,
					path: entry.path,
					rawValue: read.value,
					valueType: read.type,
					isLargeObject: isLarge,
				};
			}
		}

		return results.filter(Boolean);
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
			const matchingActive = state.networkState.activeRequests.find((entry) =>
				entry.url.toLowerCase().includes(normalized),
			);
			const matchingPerformanceEntry = performanceEntries.find((entry) =>
				entry.name.toLowerCase().includes(normalized),
			);

			if (matchingCompleted) {
				return {
					key: `bundle:${bundleName}`,
					label: bundleName,
					status: "pass",
					explanation: HELP_COPY.bundles,
					detail: `Loaded from ${truncate(matchingCompleted.url, 72)} in ${matchingCompleted.loadTimeMs ?? "?"} ms.`,
					matchedUrl: matchingCompleted.url,
					loadTimeMs: matchingCompleted.loadTimeMs,
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
					loadTimeMs: Math.round(matchingPerformanceEntry.duration),
				};
			}

			if (matchingActive) {
				return {
					key: `bundle:${bundleName}`,
					label: bundleName,
					status: "pending",
					explanation: HELP_COPY.bundles,
					detail: "We can see the script request in flight and are waiting for it to finish.",
				};
			}

			if (matchingError && hasTimedOut()) {
				return {
					key: `bundle:${bundleName}`,
					label: bundleName,
					status: "fail",
					explanation: HELP_COPY.bundles,
					detail: `A matching request failed for ${truncate(matchingError.url, 72)}.`,
					failureMessage: "Bundle request failed before the script finished loading.",
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
				failureMessage: hasTimedOut()
					? "Bundle not found - the ad script may not be installed on this page."
					: undefined,
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
					status === "fail"
						? "Class name not found - the expected ad markup may not have rendered."
						: undefined,
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
				detail: found
					? "Element found. Click this row to jump to it on the page."
					: status === "pending"
						? "Still checking whether this page element appears."
						: "Element ID not found in the current page.",
				failureMessage: status === "fail" ? "Element not found on this page." : undefined,
				targetId: domId,
				found,
			};
		});
	}

	function buildAttributeResults(): AttributeCheckResult[] {
		return state.settings.attributes.map((attributeName) => {
			const values = collectAttributeValues(attributeName);
			const status = values.length > 0 ? "pass" : pendingOrFailedStatus();
			const detail =
				values.length > 0
					? values
							.map(
								(valueSummary) =>
									`<code class="adcheck-code-chip">${escapeHtml(valueSummary.value)}</code>${valueSummary.count > 1 ? ` <span class="adcheck-count-badge">×${valueSummary.count}</span>` : ""}`,
							)
							.join(" ")
					: status === "pending"
						? "Still scanning the page for this attribute."
						: "Attribute not found.";
			const isHtml = values.length > 0;

			return {
				key: `attribute:${attributeName}`,
				label: attributeName,
				status,
				explanation: HELP_COPY.attributes,
				detail,
				detailIsHtml: isHtml,
				failureMessage: status === "fail" ? "Attribute not found." : undefined,
				attributeName,
				values,
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
					status === "fail"
						? "Cookie not found - the page may be missing required ad identity data."
						: undefined,
				storageKind: "cookie",
				valuePreview: value,
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
					status === "fail"
						? "Local storage key not found - the page may not have saved the expected ad state."
						: undefined,
				storageKind: "localStorage",
				valuePreview: value ?? undefined,
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
            <div class="adcheck-widget-header-left">
              <p class="adcheck-widget-kicker">Publisher page review</p>
              <div class="adcheck-widget-title-row">
                <h2 class="adcheck-widget-title">AdCheck</h2>
                <span class="adcheck-badge" id="adcheckStatusBadge">0/0 clear</span>
              </div>
            </div>
            <div class="adcheck-widget-actions">
              <button
                class="adcheck-refresh-btn adcheck-side-toggle-btn"
                id="adcheckSideToggleButton"
                type="button"
                aria-label="Move AdCheck to the other side"
                title="Move AdCheck to the other side"
              >
                ↔
              </button>
              <button class="adcheck-refresh-btn" id="adcheckRefreshButton" type="button" aria-label="Refresh checks" title="Refresh checks">&#8635;</button>
            </div>
          </header>
          <div class="adcheck-group-list" id="adcheckResults"></div>
        </div>
        <div class="adcheck-info-tooltip-layer" id="adcheckInfoTooltip" aria-hidden="true"></div>
      </div>
    `;
		document.documentElement.appendChild(root);
		state.root = root;
		state.infoTooltipEl = ensureInfoTooltipLayer();
		bindWidgetEvents();
		renderWidget();
	}

	function teardownWidget(): void {
		stopSitePicker();

		if (state.deadlineHandle) {
			window.clearTimeout(state.deadlineHandle);
			state.deadlineHandle = null;
		}

		stopPolling();

		state.rowHints = {};
		state.snapshot = createEmptySnapshot();
		state.lastRenderSignature = "";
		state.deadlineAt = null;
		hideInfoTooltip();
		window.removeEventListener("scroll", scheduleInfoTooltipReposition, true);
		window.removeEventListener("resize", scheduleInfoTooltipReposition);

		if (state.root) {
			state.root.remove();
			state.root = null;
		}

		if (state.infoTooltipEl) {
			state.infoTooltipEl.remove();
			state.infoTooltipEl = null;
		}
	}

	function syncPollingState(): void {
		if (!state.settings.enabled) {
			stopPolling();
			return;
		}

		if (!hasPendingChecks()) {
			stopPolling();
			return;
		}

		if (state.pollHandle) {
			return;
		}

		state.pollHandle = window.setInterval(() => {
			void runChecks(false);
		}, 1500);
	}

	function stopPolling(): void {
		if (state.pollHandle) {
			window.clearInterval(state.pollHandle);
			state.pollHandle = null;
		}
	}

	function renderWidget(): void {
		if (!state.root || !state.settings.enabled) {
			return;
		}

		const signature = JSON.stringify({
			collapsed: state.settings.widgetCollapsed,
			widgetSide: state.settings.widgetSide,
			hints: state.rowHints,
			snapshot: {
				bundles: state.snapshot.bundles,
				classNames: state.snapshot.classNames,
				domIds: state.snapshot.domIds,
				attributes: state.snapshot.attributes,
				cookies: state.snapshot.cookies,
				localStorageKeys: state.snapshot.localStorageKeys,
				windowGlobals: state.snapshot.windowGlobals,
			},
		});

		if (signature === state.lastRenderSignature) {
			return;
		}

		const sections = [
			renderGroup("Bundles", "Scripts we expect to load", state.snapshot.bundles),
			renderGroup("Page elements", "IDs you can jump to on the page", state.snapshot.domIds),
			renderGroup("Class names", "Page classes tied to ad rendering", state.snapshot.classNames),
			renderGroup("Attributes", "Values pulled directly from the DOM", state.snapshot.attributes),
			renderGroup("Cookies", "Browser cookies this setup may rely on", state.snapshot.cookies),
			renderGroup(
				"Local storage",
				"Page storage keys this setup may need",
				state.snapshot.localStorageKeys,
			),
			renderWindowGlobalsGroup(state.snapshot.windowGlobals),
		].join("");

		const widget = state.root.querySelector<HTMLElement>(".adcheck-widget");
		const results = state.root.querySelector<HTMLElement>("#adcheckResults");
		const badge = state.root.querySelector<HTMLElement>("#adcheckStatusBadge");
		const toggleLabel = state.root.querySelector<HTMLElement>("#adcheckToggleTab span");

		hideInfoTooltip();
		widget?.classList.toggle("is-collapsed", state.settings.widgetCollapsed);
		if (results) {
			results.innerHTML = sections;
		}
		state.root.classList.toggle("is-left", state.settings.widgetSide === "left");
		state.root.classList.toggle("is-right", state.settings.widgetSide !== "left");
		if (badge) {
			const passing = countPassingChecks();
			const total = countTotalChecks();
			const allPass = passing === total && total > 0;
			badge.textContent = `${passing}/${total} clear`;
			badge.classList.toggle("is-all-pass", allPass);
			void updateActionSuccessState(allPass);
		}
		if (toggleLabel) {
			toggleLabel.textContent = state.settings.widgetCollapsed ? "Open" : "Hide";
		}

		bindResultEvents();
		state.lastRenderSignature = signature;
	}

	function renderGroup(title: string, description: string, results: CheckResultBase[]): string {
		if (results.length === 0) {
			return "";
		}
		const passedCount = results.filter((result) => result.status === "pass").length;
		const allPass = passedCount === results.length;
		const metaClass = allPass ? "adcheck-group-meta is-all-pass" : "adcheck-group-meta";

		return `
      <section class="adcheck-group">
        <div class="adcheck-group-heading">
          <h3 class="adcheck-group-title">
            ${escapeHtml(title)}
            <button class="adcheck-info-btn" type="button" aria-label="About this section">
              <span class="adcheck-info-icon">i</span>
              <span class="adcheck-info-tooltip">${escapeHtml(description)}</span>
            </button>
          </h3>
          <div class="${metaClass}">${passedCount}/${results.length}</div>
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
		const hint = state.rowHints[result.key];
		const domAction =
			isDomResult(result) && result.found
				? `<button class="adcheck-dom-jump" data-dom-id="${escapeAttribute(result.targetId)}" type="button">↗ Jump to element</button>`
				: "";
		const isHtmlDetail =
			(result as AttributeCheckResult & { detailIsHtml?: boolean }).detailIsHtml === true;
		const visibleDetail = result.failureMessage
			? escapeHtml(result.failureMessage)
			: isHtmlDetail
				? result.detail
				: escapeHtml(result.detail);
		const detailClass = result.failureMessage
			? "adcheck-result-detail is-failure"
			: "adcheck-result-detail";

		return `
      <div class="${rowClass}" ${isDomResult(result) ? `data-dom-result="${escapeAttribute(result.targetId)}"` : ""}>
        <div class="adcheck-status-icon is-${result.status}">${statusIcon}</div>
        <div class="adcheck-result-body">
          <div class="adcheck-result-label-row">
            <span class="adcheck-result-label">${escapeHtml(result.label)}</span>
            <span class="adcheck-result-pill is-${result.status}">${escapeHtml(result.status)}</span>
            <button class="adcheck-info-btn" type="button" aria-label="What does this check?">
              <span class="adcheck-info-icon">i</span>
              <span class="adcheck-info-tooltip">${escapeHtml(result.explanation)}</span>
            </button>
          </div>
          <p class="${detailClass}">${visibleDetail}</p>
          ${hint ? `<p class="adcheck-result-detail is-failure">${escapeHtml(hint)}</p>` : ""}
          ${domAction}
        </div>
      </div>
    `;
	}

	function renderWindowGlobalsGroup(results: WindowGlobalCheckResult[]): string {
		if (results.length === 0) {
			return "";
		}

		const passedCount = results.filter((result) => result.status === "pass").length;
		const allPass = passedCount === results.length;
		const metaClass = allPass ? "adcheck-group-meta is-all-pass" : "adcheck-group-meta";

		const rows = results
			.map((result) => {
				const statusIcon = result.status === "pass" ? "✓" : result.status === "fail" ? "×" : "";
				const hint = state.rowHints[result.key];
				const typeBadge =
					result.status === "pass" && result.valueType
						? ` <span class="adcheck-type-badge">${escapeHtml(result.valueType)}</span>`
						: "";

				let valueBlock = "";
				if (result.status === "pass") {
					if (result.isLargeObject) {
						// Build a readable summary line instead of truncating
						let summary = result.valueType;
						const firstLine = result.rawValue.split("\n")[0] ?? "";
						if (result.valueType === "object") {
							const keyCount = (result.rawValue.match(/^\s+"/gm) || []).length;
							summary = keyCount > 0 ? `object · ${keyCount} keys` : "object";
						} else if (result.valueType === "array") {
							const itemCount = (result.rawValue.match(/^\s{2}[^\s/]/gm) || []).length;
							summary = itemCount > 0 ? `array · ${itemCount} items` : "array";
						} else {
							summary = firstLine.length > 60 ? firstLine.slice(0, 60) + "…" : firstLine;
						}

						valueBlock = `
              <div class="adcheck-global-summary">
                <span class="adcheck-global-summary-label">${escapeHtml(summary)}</span>
              </div>
              <details class="adcheck-global-expand">
                <summary class="adcheck-global-expand-btn">Show full value</summary>
                <pre class="adcheck-global-value-full">${escapeHtml(result.rawValue)}</pre>
              </details>`;
					} else {
						valueBlock = `<code class="adcheck-code-chip adcheck-global-code">${escapeHtml(result.rawValue)}</code>`;
					}
				}

				const detailText = result.failureMessage
					? `<p class="adcheck-result-detail is-failure">${escapeHtml(result.failureMessage)}</p>`
					: result.status !== "pass"
						? `<p class="adcheck-result-detail">${escapeHtml(result.detail)}</p>`
						: "";

				return `
          <div class="adcheck-result-row is-${result.status}">
            <div class="adcheck-status-icon is-${result.status}">${statusIcon}</div>
            <div class="adcheck-result-body">
              <div class="adcheck-result-label-row">
                <span class="adcheck-result-label">${escapeHtml(result.label)}</span>
                <span class="adcheck-result-pill is-${result.status}">${escapeHtml(result.status)}</span>
                ${typeBadge}
                <button class="adcheck-info-btn" type="button" aria-label="What does this check?">
                  <span class="adcheck-info-icon">i</span>
                  <span class="adcheck-info-tooltip">${escapeHtml(result.explanation)}</span>
                </button>
              </div>
              ${detailText}
              ${valueBlock}
              ${hint ? `<p class="adcheck-result-detail is-failure">${escapeHtml(hint)}</p>` : ""}
            </div>
          </div>
        `;
			})
			.join("");

		return `
      <section class="adcheck-group">
        <div class="adcheck-group-heading">
          <h3 class="adcheck-group-title">
            Window globals
            <button class="adcheck-info-btn" type="button" aria-label="About this section">
              <span class="adcheck-info-icon">i</span>
              <span class="adcheck-info-tooltip">Values read from the page's window object</span>
            </button>
          </h3>
          <div class="${metaClass}">${passedCount}/${results.length}</div>
        </div>
        <div class="adcheck-results">
          ${rows}
        </div>
      </section>
    `;
	}

	function bindWidgetEvents(): void {
		if (!state.root) {
			return;
		}

		state.root
			.querySelector<HTMLButtonElement>("#adcheckRefreshButton")
			?.addEventListener("click", () => {
				void runChecks(true);
			});

		state.root
			.querySelector<HTMLButtonElement>("#adcheckToggleTab")
			?.addEventListener("click", () => {
				void persistCollapsedState(!state.settings.widgetCollapsed);
			});

		state.root
			.querySelector<HTMLButtonElement>("#adcheckSideToggleButton")
			?.addEventListener("click", () => {
				void persistWidgetSide(state.settings.widgetSide === "left" ? "right" : "left");
			});

		state.root.addEventListener("pointerover", handleInfoTooltipEvent);
		state.root.addEventListener("pointerout", handleInfoTooltipEvent);
		state.root.addEventListener("focusin", handleInfoTooltipEvent);
		state.root.addEventListener("focusout", handleInfoTooltipEvent);
		window.addEventListener("scroll", scheduleInfoTooltipReposition, true);
		window.addEventListener("resize", scheduleInfoTooltipReposition);
	}

	function bindResultEvents(): void {
		if (!state.root) {
			return;
		}

		for (const button of Array.from(
			state.root.querySelectorAll<HTMLButtonElement>("[data-dom-id]"),
		)) {
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

	function handleInfoTooltipEvent(event: Event): void {
		const target =
			event.target instanceof Element
				? event.target.closest<HTMLButtonElement>(".adcheck-info-btn")
				: null;
		if (!(target instanceof HTMLButtonElement)) {
			if (event.type === "pointerout" || event.type === "focusout") {
				hideInfoTooltip();
			}
			return;
		}

		if (event.type === "pointerout") {
			const related = (event as PointerEvent).relatedTarget;
			if (related instanceof Node && target.contains(related)) {
				return;
			}
			hideInfoTooltip();
			return;
		}

		if (event.type === "focusout") {
			const related = (event as FocusEvent).relatedTarget;
			if (related instanceof Node && target.contains(related)) {
				return;
			}
			hideInfoTooltip();
			return;
		}

		showInfoTooltip(target);
	}

	function showInfoTooltip(button: HTMLButtonElement): void {
		const tooltipEl = state.infoTooltipEl;
		if (!tooltipEl) {
			return;
		}

		const content = button.querySelector<HTMLElement>(".adcheck-info-tooltip")?.textContent?.trim();
		if (!content) {
			return;
		}

		if (state.infoTooltipHideTimeout) {
			window.clearTimeout(state.infoTooltipHideTimeout);
			state.infoTooltipHideTimeout = null;
		}

		state.infoTooltipTarget = button;
		tooltipEl.textContent = content;
		tooltipEl.classList.add("is-visible");
		tooltipEl.setAttribute("data-placement", "top");
		scheduleInfoTooltipReposition();
	}

	function ensureInfoTooltipLayer(): HTMLDivElement | null {
		const existing = document.getElementById("adcheckInfoTooltip");
		if (existing instanceof HTMLDivElement) {
			if (existing.parentElement !== document.documentElement) {
				document.documentElement.appendChild(existing);
			}
			return existing;
		}

		const tooltipEl = document.createElement("div");
		tooltipEl.id = "adcheckInfoTooltip";
		tooltipEl.className = "adcheck-info-tooltip-layer";
		tooltipEl.setAttribute("aria-hidden", "true");
		document.documentElement.appendChild(tooltipEl);
		return tooltipEl;
	}

	function scheduleInfoTooltipReposition(): void {
		if (!state.infoTooltipEl || !state.infoTooltipTarget) {
			return;
		}

		if (state.infoTooltipRaf !== null) {
			window.cancelAnimationFrame(state.infoTooltipRaf);
		}

		state.infoTooltipRaf = window.requestAnimationFrame(() => {
			state.infoTooltipRaf = null;
			positionInfoTooltip();
		});
	}

	function positionInfoTooltip(): void {
		const tooltipEl = state.infoTooltipEl;
		const target = state.infoTooltipTarget;
		if (!tooltipEl || !target) {
			return;
		}

		const targetRect = target.getBoundingClientRect();
		const tooltipRect = tooltipEl.getBoundingClientRect();
		const viewportWidth = window.innerWidth;
		const viewportHeight = window.innerHeight;
		const viewportMarginPx = 12;
		const verticalGapPx = 10;
		const centeredLeft = targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
		const left = Math.max(
			viewportMarginPx,
			Math.min(centeredLeft, viewportWidth - viewportMarginPx - tooltipRect.width),
		);

		let top = targetRect.top - tooltipRect.height - verticalGapPx;
		let placement: "top" | "bottom" = "top";
		if (top < viewportMarginPx) {
			top = targetRect.bottom + verticalGapPx;
			placement = "bottom";
		}
		if (top + tooltipRect.height > viewportHeight - viewportMarginPx) {
			top = Math.max(viewportMarginPx, viewportHeight - viewportMarginPx - tooltipRect.height);
		}

		tooltipEl.style.left = `${Math.round(left)}px`;
		tooltipEl.style.top = `${Math.round(top)}px`;
		tooltipEl.setAttribute("data-placement", placement);
	}

	function hideInfoTooltip(): void {
		const tooltipEl = state.infoTooltipEl;
		if (!tooltipEl) {
			return;
		}

		state.infoTooltipTarget = null;
		if (state.infoTooltipRaf !== null) {
			window.cancelAnimationFrame(state.infoTooltipRaf);
			state.infoTooltipRaf = null;
		}

		if (state.infoTooltipHideTimeout) {
			window.clearTimeout(state.infoTooltipHideTimeout);
		}

		state.infoTooltipHideTimeout = window.setTimeout(() => {
			tooltipEl.classList.remove("is-visible");
			tooltipEl.removeAttribute("data-placement");
			tooltipEl.style.left = "";
			tooltipEl.style.top = "";
			tooltipEl.textContent = "";
			state.infoTooltipHideTimeout = null;
		}, 80);
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
			inline: "nearest",
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
			widgetCollapsed: nextCollapsed,
		};

		try {
			await chrome.storage.sync.set({
				[AdCheckShared.STORAGE_KEY]: merged,
			});
		} catch (error: unknown) {
			if (isExtensionContextInvalidatedError(error)) {
				return;
			}

			throw error;
		}
	}

	async function persistWidgetSide(nextSide: Settings["widgetSide"]): Promise<void> {
		const merged = {
			...state.settings,
			widgetSide: nextSide,
		};

		try {
			await chrome.storage.sync.set({
				[AdCheckShared.STORAGE_KEY]: merged,
			});
		} catch (error: unknown) {
			if (isExtensionContextInvalidatedError(error)) {
				return;
			}

			throw error;
		}
	}

	function scheduleDeadlineRender(): void {
		if (state.deadlineHandle) {
			window.clearTimeout(state.deadlineHandle);
		}

		state.deadlineHandle = window.setTimeout(() => {
			void runChecks(false);
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

		let rawCookieString = "";

		try {
			rawCookieString = document?.cookie;
		} catch {
			return cookieMap;
		}

		if (!rawCookieString) {
			return cookieMap;
		}

		for (const rawPair of rawCookieString.split(";")) {
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
			count,
		}));
	}

	function countPassingChecks(): number {
		const allResults = [
			...state.snapshot.bundles,
			...state.snapshot.classNames,
			...state.snapshot.domIds,
			...state.snapshot.attributes,
			...state.snapshot.cookies,
			...state.snapshot.localStorageKeys,
			...state.snapshot.windowGlobals,
		];

		return allResults.filter((result) => result.status === "pass").length;
	}

	function countTotalChecks(): number {
		const allResults: CheckResultBase[] = [
			...state.snapshot.bundles,
			...state.snapshot.classNames,
			...state.snapshot.domIds,
			...state.snapshot.attributes,
			...state.snapshot.cookies,
			...state.snapshot.localStorageKeys,
			...state.snapshot.windowGlobals,
		];

		return allResults.length;
	}

	function hasPendingChecks(): boolean {
		const allResults = [
			...state.snapshot.bundles,
			...state.snapshot.classNames,
			...state.snapshot.domIds,
			...state.snapshot.attributes,
			...state.snapshot.cookies,
			...state.snapshot.localStorageKeys,
			...state.snapshot.windowGlobals,
		];

		return allResults.some((result) => result.status === "pending");
	}

	function createEmptySnapshot(): PageCheckSnapshot {
		return {
			bundles: [],
			classNames: [],
			domIds: [],
			attributes: [],
			cookies: [],
			localStorageKeys: [],
			windowGlobals: [],
			lastRunAt: Date.now(),
		};
	}

	function shouldIgnoreCurrentPage(settings: Settings): boolean {
		if (settings.ignoredDomains.length === 0) {
			return false;
		}

		const hostname = window.location.hostname.toLowerCase();

		return settings.ignoredDomains.some((entry) =>
			AdCheckShared.matchesIgnoredDomain(entry, hostname),
		);
	}

	async function loadSettings(): Promise<Settings> {
		const response = await sendMessage<{ ok: boolean; settings?: Settings }>({
			type: "GET_SETTINGS",
		});

		return AdCheckShared.mergeSettings(response?.settings);
	}

	async function loadSiteOverrides(): Promise<SiteOverrideRule[]> {
		try {
			const result = await chrome.storage.local.get(AdCheckShared.SITE_OVERRIDE_STORAGE_KEY);
			return AdCheckShared.normalizeSiteOverrides(
				result[AdCheckShared.SITE_OVERRIDE_STORAGE_KEY] as SiteOverrideRule[] | undefined,
			);
		} catch {
			return [];
		}
	}

	async function getNetworkState(
		messageType: "GET_TAB_NETWORK_STATE" | "REFRESH_TAB_NETWORK_STATE",
	): Promise<NetworkTabState> {
		const response = await sendMessage<{ ok: boolean; state?: NetworkTabState }>({
			type: messageType,
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

	async function updateActionSuccessState(allPass: boolean): Promise<void> {
		await sendMessage({
			type: "SET_ACTION_SUCCESS_STATE",
			allPass,
		});
	}

	function cssEscape(value: string): string {
		if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
			return CSS.escape(value);
		}

		return value.replace(/["\\\]]/g, "\\$&");
	}

	function buildSelector(element: Element): string {
		const htmlElement = element as HTMLElement;
		if (htmlElement.id) {
			return `#${cssEscape(htmlElement.id)}`;
		}

		const parts: string[] = [];
		let current: Element | null = element;
		while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
			const segment = selectorSegment(current);
			parts.unshift(segment);

			const trialSelector = parts.join(" > ");
			try {
				if (document.querySelectorAll(trialSelector).length === 1) {
					return trialSelector;
				}
			} catch {
				// Keep building a safer fallback path.
			}

			current = current.parentElement;
		}

		return parts.join(" > ");
	}

	function selectorSegment(element: Element): string {
		const htmlElement = element as HTMLElement;
		const tagName = element.tagName.toLowerCase();
		if (htmlElement.id) {
			return `#${cssEscape(htmlElement.id)}`;
		}

		const classNames = Array.from(element.classList)
			.filter((className) => !className.startsWith("adcheck-"))
			.slice(0, 2)
			.map((className) => `.${cssEscape(className)}`)
			.join("");
		if (classNames) {
			return `${tagName}${classNames}`;
		}

		const siblings = element.parentElement
			? Array.from(element.parentElement.children).filter(
					(sibling) => sibling.tagName.toLowerCase() === tagName,
				)
			: [];
		if (siblings.length <= 1) {
			return tagName;
		}

		return `${tagName}:nth-of-type(${siblings.indexOf(element) + 1})`;
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

	function isExtensionContextInvalidatedError(error: unknown): boolean {
		return error instanceof Error && error.message.includes("Extension context invalidated");
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
