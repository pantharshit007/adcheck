/// <reference path="./shared/types.ts" />

(() => {
	type Settings = AdCheckShared.Settings;
	type SettingsSection = (typeof AdCheckShared.SETTINGS_SECTIONS)[number];
	type SiteOverrideRule = AdCheckShared.SiteOverrideRule;
	type SitePickerSelection = AdCheckShared.SitePickerSelection;
	type UserScriptStatus = AdCheckShared.UserScriptStatus;

	interface ActiveSiteContext {
		hostname: string;
		tabId: number;
	}

	const formRoot = document.getElementById("settingsForm") as HTMLDivElement | null;
	const saveButton = document.getElementById("saveButton") as HTMLButtonElement | null;
	const resetDefaultsButton = document.getElementById(
		"resetDefaultsButton",
	) as HTMLButtonElement | null;
	const enabledToggle = document.getElementById("enabledToggle") as HTMLInputElement | null;
	const statusMessage = document.getElementById("statusMessage") as HTMLParagraphElement | null;
	const popupStateLabel = document.getElementById("popupStateLabel") as HTMLParagraphElement | null;
	const importExportInput = document.getElementById(
		"importExportInput",
	) as HTMLTextAreaElement | null;
	const exportButton = document.getElementById("exportButton") as HTMLButtonElement | null;
	const importFileButton = document.getElementById("importFileButton") as HTMLButtonElement | null;
	const importFileInput = document.getElementById("importFileInput") as HTMLInputElement | null;
	const applyImportButton = document.getElementById(
		"applyImportButton",
	) as HTMLButtonElement | null;
	const importExportEditor = document.getElementById("importExportEditor") as HTMLDivElement | null;
	const toggleImportEditorButton = document.getElementById(
		"toggleImportEditorButton",
	) as HTMLButtonElement | null;
	const closeImportEditorButton = document.getElementById(
		"closeImportEditorButton",
	) as HTMLButtonElement | null;
	const siteOverrideSiteLabel = document.getElementById(
		"siteOverrideSiteLabel",
	) as HTMLParagraphElement | null;
	const siteOverrideSelectionLabel = document.getElementById(
		"siteOverrideSelectionLabel",
	) as HTMLParagraphElement | null;
	const siteOverridePermissionMessage = document.getElementById(
		"siteOverridePermissionMessage",
	) as HTMLParagraphElement | null;
	const siteOverrideEditor = document.getElementById("siteOverrideEditor") as HTMLDivElement | null;
	const toggleSiteOverrideEditorButton = document.getElementById(
		"toggleSiteOverrideEditorButton",
	) as HTMLButtonElement | null;
	const pickSiteElementButton = document.getElementById(
		"pickSiteElementButton",
	) as HTMLButtonElement | null;
	const clearSiteSelectionButton = document.getElementById(
		"clearSiteSelectionButton",
	) as HTMLButtonElement | null;
	const siteOverrideEnabledInput = document.getElementById(
		"siteOverrideEnabledInput",
	) as HTMLInputElement | null;
	const siteOverridePlacementSelect = document.getElementById(
		"siteOverridePlacementSelect",
	) as HTMLSelectElement | null;
	const siteOverrideSnippetInput = document.getElementById(
		"siteOverrideSnippetInput",
	) as HTMLTextAreaElement | null;
	const saveSiteOverrideButton = document.getElementById(
		"saveSiteOverrideButton",
	) as HTMLButtonElement | null;
	const deleteSiteOverrideButton = document.getElementById(
		"deleteSiteOverrideButton",
	) as HTMLButtonElement | null;

	const popupState: {
		activeSite: ActiveSiteContext | null;
		pickedSelection: SitePickerSelection | null;
		userScriptStatus: UserScriptStatus | null;
	} = {
		activeSite: null,
		pickedSelection: null,
		userScriptStatus: null,
	};

	void initializePopup();

	async function initializePopup(): Promise<void> {
		if (
			!formRoot ||
			!saveButton ||
			!resetDefaultsButton ||
			!enabledToggle ||
			!statusMessage ||
			!popupStateLabel ||
			!importExportInput ||
			!exportButton ||
			!importFileButton ||
			!importFileInput ||
			!applyImportButton ||
			!importExportEditor ||
			!toggleImportEditorButton ||
			!closeImportEditorButton ||
			!siteOverrideSiteLabel ||
			!siteOverrideSelectionLabel ||
			!siteOverridePermissionMessage ||
			!siteOverrideEditor ||
			!toggleSiteOverrideEditorButton ||
			!pickSiteElementButton ||
			!clearSiteSelectionButton ||
			!siteOverrideEnabledInput ||
			!siteOverridePlacementSelect ||
			!siteOverrideSnippetInput ||
			!saveSiteOverrideButton ||
			!deleteSiteOverrideButton
		) {
			return;
		}

		const settings = await loadSettings();
		renderSettingsForm(settings);
		populateImportExportInput(settings);
		setImportEditorVisible(false);
		setSiteOverrideEditorVisible(false);
		await initializeSiteOverridePanel();

		saveButton.addEventListener("click", () => {
			void saveSettings();
		});

		enabledToggle.addEventListener("change", () => {
			void persistEnabledState();
		});

		exportButton.addEventListener("click", () => {
			exportSettings();
		});

		importFileButton.addEventListener("click", () => {
			importFileInput.click();
		});

		importFileInput.addEventListener("change", () => {
			void importSettingsFromFile();
		});

		applyImportButton.addEventListener("click", () => {
			void applyImportedSettings();
		});

		toggleImportEditorButton.addEventListener("click", () => {
			setImportEditorVisible(!isImportEditorVisible());
		});

		closeImportEditorButton.addEventListener("click", () => {
			setImportEditorVisible(false);
		});

		resetDefaultsButton.addEventListener("click", () => {
			const defaults = AdCheckShared.cloneDefaultSettings();
			renderSettingsForm(defaults);
			populateImportExportInput(defaults);
			void persistSettings(defaults, "Defaults restored.");
		});

		pickSiteElementButton.addEventListener("click", () => {
			void startSiteElementPicker();
		});

		clearSiteSelectionButton.addEventListener("click", () => {
			void clearSiteSelection();
		});

		saveSiteOverrideButton.addEventListener("click", () => {
			void saveSiteOverride();
		});

		deleteSiteOverrideButton.addEventListener("click", () => {
			void deleteSiteOverride();
		});

		siteOverrideSnippetInput.addEventListener("input", () => {
			void refreshUserScriptWarning(siteOverrideSnippetInput.value);
		});

		toggleSiteOverrideEditorButton.addEventListener("click", () => {
			setSiteOverrideEditorVisible(!isSiteOverrideEditorVisible());
		});
	}

	async function initializeSiteOverridePanel(): Promise<void> {
		popupState.activeSite = await getActiveSiteContext();
		popupState.userScriptStatus = await detectUserScriptStatus();

		if (!popupState.activeSite) {
			renderSiteOverrideUnavailable();
			return;
		}

		siteOverrideSiteLabel!.textContent = `Saved separately for ${popupState.activeSite.hostname}. These overrides do not affect import or export settings.`;
		popupState.pickedSelection = await loadSiteSelection(popupState.activeSite.hostname);
		const override = await loadSiteOverride(popupState.activeSite.hostname);
		hydrateSiteOverridePanel(override, popupState.pickedSelection);
	}

	function renderSiteOverrideUnavailable(): void {
		if (!siteOverrideSiteLabel || !siteOverrideSelectionLabel || !toggleSiteOverrideEditorButton) {
			return;
		}

		siteOverrideSiteLabel.textContent =
			"Open a normal http or https page to save a site-specific override.";
		siteOverrideSelectionLabel.textContent = "Site overrides are unavailable on this tab.";
		void refreshUserScriptWarning("");
		toggleSiteOverrideEditorButton.disabled = true;
		if (pickSiteElementButton) {
			pickSiteElementButton.disabled = true;
		}
		if (clearSiteSelectionButton) {
			clearSiteSelectionButton.disabled = true;
		}
		if (siteOverrideEnabledInput) {
			siteOverrideEnabledInput.disabled = true;
		}
		if (siteOverridePlacementSelect) {
			siteOverridePlacementSelect.disabled = true;
		}
		if (siteOverrideSnippetInput) {
			siteOverrideSnippetInput.disabled = true;
		}
		if (saveSiteOverrideButton) {
			saveSiteOverrideButton.disabled = true;
		}
		if (deleteSiteOverrideButton) {
			deleteSiteOverrideButton.disabled = true;
		}
	}

	function hydrateSiteOverridePanel(
		override: SiteOverrideRule | null,
		selection: SitePickerSelection | null,
	): void {
		if (!siteOverrideEnabledInput || !siteOverridePlacementSelect || !siteOverrideSnippetInput) {
			return;
		}

		siteOverrideEnabledInput.checked = override?.enabled ?? true;
		siteOverridePlacementSelect.value = override?.placement ?? "afterend";
		siteOverrideSnippetInput.value = override?.htmlSnippet ?? "";
		renderPickedSelection(selection ?? selectorToSelection(override?.selector ?? ""));
		setSiteOverrideEditorVisible(false); // always start collapsed, like other sections
		void refreshUserScriptWarning(override?.htmlSnippet ?? "");
	}

	function renderPickedSelection(selection: SitePickerSelection | null): void {
		if (!siteOverrideSelectionLabel) {
			return;
		}

		if (!selection || !selection.selector) {
			siteOverrideSelectionLabel.textContent = "No element selected yet.";
			siteOverrideSelectionLabel.removeAttribute("data-has-selection");
			return;
		}

		// TODO 4: display selected element info as a styled code block
		const targetLabel = selection.tagName ? `${selection.tagName} at ` : "";
		const dimensions = selection.dimensionsLabel ? ` (${selection.dimensionsLabel})` : "";
		const selectorText = `${targetLabel}${selection.selector}${dimensions}`;
		siteOverrideSelectionLabel.setAttribute("data-has-selection", "true");
		siteOverrideSelectionLabel.innerHTML = `<code class="adcheck-selection-code">${escapeHtml(selectorText)}</code>`;
	}

	async function startSiteElementPicker(): Promise<void> {
		if (!popupState.activeSite) {
			return;
		}

		const activeTab = await getActiveTab();
		if (!activeTab?.id) {
			showStatus("Active tab is unavailable.");
			return;
		}

		try {
			await chrome.tabs.sendMessage(activeTab.id, {
				type: "START_SITE_PICKER",
			} satisfies AdCheckShared.RuntimeMessage);
			showStatus("Picker is armed. Click the page element, then reopen AdCheck.");
			window.close();
		} catch {
			showStatus("Reload the page once, then try the picker again.");
		}
	}

	async function clearSiteSelection(): Promise<void> {
		if (!popupState.activeSite) {
			return;
		}

		popupState.pickedSelection = null;
		await chrome.storage.local.remove(
			AdCheckShared.sitePickSelectionStorageKey(popupState.activeSite.hostname),
		);
		renderPickedSelection(null);
		showStatus("Selection cleared.");
	}

	async function saveSiteOverride(): Promise<void> {
		if (
			!popupState.activeSite ||
			!siteOverrideEnabledInput ||
			!siteOverridePlacementSelect ||
			!siteOverrideSnippetInput
		) {
			return;
		}

		popupState.pickedSelection = await loadSiteSelection(popupState.activeSite.hostname);
		const selector = popupState.pickedSelection?.selector?.trim();
		const htmlSnippet = siteOverrideSnippetInput.value.trim();

		if (!selector) {
			showStatus("Pick a page element first.");
			return;
		}

		if (!htmlSnippet) {
			showStatus("Paste the tag snippet before saving.");
			return;
		}

		await refreshUserScriptWarning(htmlSnippet);

		const nextOverride: SiteOverrideRule = {
			hostname: popupState.activeSite.hostname,
			selector,
			placement: AdCheckShared.normalizePlacement(siteOverridePlacementSelect.value),
			htmlSnippet,
			enabled: siteOverrideEnabledInput.checked,
			updatedAt: Date.now(),
		};

		const overrides = await loadSiteOverrides();
		const remainingOverrides = overrides.filter(
			(entry) => entry.hostname !== nextOverride.hostname,
		);
		remainingOverrides.unshift(nextOverride);
		await chrome.storage.local.set({
			[AdCheckShared.SITE_OVERRIDE_STORAGE_KEY]: remainingOverrides,
		});

		renderPickedSelection(popupState.pickedSelection);
		showStatus(
			hasInlineScript(htmlSnippet) && popupState.userScriptStatus?.available === false
				? "Saved, but inline scripts still need the user-script permission warning resolved below."
				: "Site override saved for this website.",
		);
	}

	async function deleteSiteOverride(): Promise<void> {
		if (
			!popupState.activeSite ||
			!siteOverrideEnabledInput ||
			!siteOverridePlacementSelect ||
			!siteOverrideSnippetInput
		) {
			return;
		}

		const overrides = await loadSiteOverrides();
		const remainingOverrides = overrides.filter(
			(entry) => entry.hostname !== popupState.activeSite?.hostname,
		);
		await chrome.storage.local.set({
			[AdCheckShared.SITE_OVERRIDE_STORAGE_KEY]: remainingOverrides,
		});

		siteOverrideEnabledInput.checked = true;
		siteOverridePlacementSelect.value = "afterend";
		siteOverrideSnippetInput.value = "";
		// TODO 2: after delete, keep the editor open — don't collapse back to "Show details"
		// setSiteOverrideEditorVisible(false)  <-- intentionally NOT closing the editor
		void refreshUserScriptWarning("");
		showStatus("Site override deleted.");
	}

	async function getActiveSiteContext(): Promise<ActiveSiteContext | null> {
		const activeTab = await getActiveTab();
		if (!activeTab?.id || !activeTab.url) {
			return null;
		}

		try {
			const url = new URL(activeTab.url);
			if (url.protocol !== "http:" && url.protocol !== "https:") {
				return null;
			}

			return {
				hostname: url.hostname.toLowerCase(),
				tabId: activeTab.id,
			};
		} catch {
			return null;
		}
	}

	async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
		const [activeTab] = await chrome.tabs.query({
			active: true,
			currentWindow: true,
		});
		return activeTab ?? null;
	}

	async function loadSiteOverrides(): Promise<SiteOverrideRule[]> {
		const result = await chrome.storage.local.get(AdCheckShared.SITE_OVERRIDE_STORAGE_KEY);
		return AdCheckShared.normalizeSiteOverrides(
			result[AdCheckShared.SITE_OVERRIDE_STORAGE_KEY] as SiteOverrideRule[] | undefined,
		);
	}

	async function loadSiteOverride(hostname: string): Promise<SiteOverrideRule | null> {
		const overrides = await loadSiteOverrides();
		return AdCheckShared.findSiteOverrideForHostname(overrides, hostname);
	}

	async function loadSiteSelection(hostname: string): Promise<SitePickerSelection | null> {
		const result = await chrome.storage.local.get(
			AdCheckShared.sitePickSelectionStorageKey(hostname),
		);
		const selection = result[AdCheckShared.sitePickSelectionStorageKey(hostname)] as
			| SitePickerSelection
			| undefined;
		if (!selection || typeof selection.selector !== "string") {
			return null;
		}

		return selection;
	}

	async function refreshUserScriptWarning(htmlSnippet: string): Promise<void> {
		popupState.userScriptStatus = await detectUserScriptStatus();
		renderUserScriptWarning(htmlSnippet);
	}

	function renderUserScriptWarning(htmlSnippet: string): void {
		if (!siteOverridePermissionMessage) {
			return;
		}

		const hasInlineScriptSnippet = hasInlineScript(htmlSnippet);
		const isPermissionUnavailable = popupState.userScriptStatus?.available === false;

		siteOverridePermissionMessage.classList.remove("is-warning");

		if (!hasInlineScriptSnippet || !isPermissionUnavailable) {
			siteOverridePermissionMessage.classList.add("is-hidden");
			siteOverridePermissionMessage.textContent = "";
			return;
		}

		siteOverridePermissionMessage.classList.remove("is-hidden");
		siteOverridePermissionMessage.classList.add("is-warning");
		siteOverridePermissionMessage.textContent =
			popupState.userScriptStatus?.message ||
			"This override includes inline script blocks. Enable Allow User Scripts in AdCheck's extension details so the inline loader code can run.";
	}

	function hasInlineScript(htmlSnippet: string): boolean {
		return /<script\b(?![^>]*\bsrc=)[^>]*>/i.test(htmlSnippet);
	}

	async function detectUserScriptStatus(): Promise<UserScriptStatus> {
		const chromeMajorVersion = parseChromeMajorVersion();

		try {
			await chrome.userScripts.getScripts();
			return {
				available: true,
				chromeMajorVersion,
				message: "",
			};
		} catch {
			if (chromeMajorVersion !== null && chromeMajorVersion >= 138) {
				return {
					available: false,
					chromeMajorVersion,
					message:
						"This override includes inline script blocks. Enable Allow User Scripts in AdCheck's extension details and reload the extension so the inline loader code can run.",
				};
			}

			return {
				available: false,
				chromeMajorVersion,
				message:
					"This override includes inline script blocks. Enable Developer mode or update Chrome so the inline loader code can run.",
			};
		}
	}

	function parseChromeMajorVersion(): number | null {
		const match = navigator.userAgent.match(/(Chrome|Chromium)\/([0-9]+)/);
		if (!match) {
			return null;
		}

		const parsed = Number.parseInt(match[2], 10);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function selectorToSelection(selector: string): SitePickerSelection | null {
		const trimmed = selector.trim();
		if (!trimmed || !popupState.activeSite) {
			return null;
		}

		return {
			hostname: popupState.activeSite.hostname,
			selector: trimmed,
			tagName: "",
			dimensionsLabel: "",
			updatedAt: Date.now(),
		};
	}

	function renderSettingsForm(settings: Settings): void {
		if (!formRoot || !enabledToggle || !popupStateLabel) {
			return;
		}

		enabledToggle.checked = settings.enabled;
		popupStateLabel.textContent = settings.enabled ? "AdCheck Active" : "AdCheck Paused";
		formRoot.innerHTML = AdCheckShared.SETTINGS_SECTIONS.map((section) =>
			renderSection(section, settings),
		).join("");
		bindSectionActions();
	}

	function renderSection(section: SettingsSection, settings: Settings): string {
		const values = settings[section.key];
		// Always start collapsed on open — user clicks to expand
		const startExpanded = false;
		const rows = (values.length > 0 ? values : [""])
			.map(
				(value, index) => `
          <div class="adcheck-entry-row">
            <input
              class="adcheck-entry-input"
              type="text"
              value="${escapeHtml(value)}"
              placeholder="${escapeHtml(section.placeholder)}"
              data-section-key="${section.key}"
              data-entry-index="${index}"
            />
            <button class="adcheck-row-remove" type="button" data-remove-row="${section.key}" aria-label="Remove ${escapeHtml(section.title)} item">×</button>
          </div>
        `,
			)
			.join("");

		const itemCount = values.filter((v) => v.trim() !== "").length;
		const countBadge =
			itemCount > 0 ? `<span class="adcheck-section-count">${itemCount}</span>` : "";

		return `
      <section class="adcheck-config-section${startExpanded ? " is-expanded" : ""}" data-section="${section.key}">
        <div class="adcheck-config-section-header adcheck-section-accordion-header" data-accordion-toggle="${section.key}" role="button" tabindex="0" aria-expanded="${startExpanded}">
          <div class="adcheck-section-header-left">
            <div class="adcheck-section-title-row">
              <p class="adcheck-section-title">${escapeHtml(section.title)}</p>
              ${countBadge}
            </div>
            <p class="adcheck-section-copy">${escapeHtml(section.description)}</p>
          </div>
          <div class="adcheck-section-header-right">
            <button class="adcheck-add-button" type="button" data-add-row="${section.key}">Add</button>
            <span class="adcheck-section-chevron" aria-hidden="true">›</span>
          </div>
        </div>
        <div class="adcheck-entry-list${startExpanded ? "" : " is-hidden"}" data-entry-list="${section.key}">
          ${rows}
        </div>
      </section>
    `;
	}

	function bindSectionActions(): void {
		if (!formRoot) {
			return;
		}

		for (const button of Array.from(
			formRoot.querySelectorAll<HTMLButtonElement>("[data-add-row]"),
		)) {
			button.addEventListener("click", (event) => {
				// Prevent the click from bubbling to the accordion header
				event.stopPropagation();
				const sectionKey = button.dataset.addRow ?? "";
				// Expand the section when adding a row
				expandSection(sectionKey);
				addRow(sectionKey);
			});
		}

		for (const button of Array.from(
			formRoot.querySelectorAll<HTMLButtonElement>("[data-remove-row]"),
		)) {
			button.addEventListener("click", () => {
				removeRow(button);
			});
		}

		// TODO 5: wire up accordion toggle for each section header
		for (const header of Array.from(
			formRoot.querySelectorAll<HTMLElement>("[data-accordion-toggle]"),
		)) {
			const toggleFn = (event: Event) => {
				// Don't toggle when clicking the Add button inside the header
				if ((event.target as HTMLElement).closest(".adcheck-add-button")) {
					return;
				}
				const sectionKey = header.dataset.accordionToggle ?? "";
				toggleSection(sectionKey);
			};
			header.addEventListener("click", toggleFn);
			header.addEventListener("keydown", (event: KeyboardEvent) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					toggleFn(event);
				}
			});
		}
	}

	function toggleSection(sectionKey: string): void {
		if (!formRoot) return;
		const section = formRoot.querySelector<HTMLElement>(`[data-section="${sectionKey}"]`);
		if (!section) return;
		const isExpanded = section.classList.contains("is-expanded");
		if (isExpanded) {
			collapseSection(sectionKey);
		} else {
			expandSection(sectionKey);
		}
	}

	function expandSection(sectionKey: string): void {
		if (!formRoot) return;
		const section = formRoot.querySelector<HTMLElement>(`[data-section="${sectionKey}"]`);
		if (!section) return;
		section.classList.add("is-expanded");
		const list = section.querySelector<HTMLElement>(`[data-entry-list="${sectionKey}"]`);
		list?.classList.remove("is-hidden");
		const header = section.querySelector<HTMLElement>("[data-accordion-toggle]");
		header?.setAttribute("aria-expanded", "true");
	}

	function collapseSection(sectionKey: string): void {
		if (!formRoot) return;
		const section = formRoot.querySelector<HTMLElement>(`[data-section="${sectionKey}"]`);
		if (!section) return;
		section.classList.remove("is-expanded");
		const list = section.querySelector<HTMLElement>(`[data-entry-list="${sectionKey}"]`);
		list?.classList.add("is-hidden");
		const header = section.querySelector<HTMLElement>("[data-accordion-toggle]");
		header?.setAttribute("aria-expanded", "false");
	}

	function addRow(sectionKey: string): void {
		if (!formRoot) {
			return;
		}

		const list = formRoot.querySelector<HTMLElement>(`[data-entry-list="${sectionKey}"]`);
		if (!list) {
			return;
		}

		const section = AdCheckShared.SETTINGS_SECTIONS.find((entry) => entry.key === sectionKey);
		if (!section) {
			return;
		}

		const wrapper = document.createElement("div");
		wrapper.className = "adcheck-entry-row";
		wrapper.innerHTML = `
      <input
        class="adcheck-entry-input"
        type="text"
        value=""
        placeholder="${escapeHtml(section.placeholder)}"
        data-section-key="${section.key}"
      />
      <button class="adcheck-row-remove" type="button" data-remove-row="${section.key}" aria-label="Remove ${escapeHtml(section.title)} item">×</button>
    `;

		list.appendChild(wrapper);
		wrapper.querySelector<HTMLInputElement>(".adcheck-entry-input")?.focus();
		wrapper.querySelector<HTMLButtonElement>("[data-remove-row]")?.addEventListener("click", () => {
			removeRow(wrapper.querySelector<HTMLButtonElement>("[data-remove-row]"));
		});
	}

	function removeRow(button: HTMLButtonElement | null): void {
		if (!button) {
			return;
		}

		const row = button.closest(".adcheck-entry-row");
		const list = button.closest(".adcheck-entry-list");
		row?.remove();

		if (list && list.children.length === 0) {
			addRow(button.dataset.removeRow ?? "");
		}
	}

	async function saveSettings(): Promise<void> {
		const settings = collectSettingsFromForm();
		await persistSettings(settings, "Settings saved.");
	}

	async function persistEnabledState(): Promise<void> {
		const settings = collectSettingsFromForm();
		await persistSettings(settings, settings.enabled ? "AdCheck enabled." : "AdCheck disabled.");
	}

	async function persistSettings(settings: Settings, message: string): Promise<void> {
		try {
			await chrome.storage.sync.set({
				[AdCheckShared.STORAGE_KEY]: settings,
			});
			await chrome.runtime.sendMessage({
				type: "SYNC_ACTION_STATE",
			} satisfies AdCheckShared.RuntimeMessage);
			renderSettingsForm(settings);
			populateImportExportInput(settings);
			showStatus(message);
		} catch (error: unknown) {
			if (isExtensionContextInvalidatedError(error)) {
				showStatus("Extension reloaded. Reopen the popup.");
				return;
			}

			throw error;
		}
	}

	async function applyImportedSettings(): Promise<void> {
		if (!importExportInput) {
			return;
		}

		if (!isImportEditorVisible()) {
			setImportEditorVisible(true, true);
			showStatus("Paste JSON, then apply.");
			return;
		}

		const nextSettings = parseImportedSettings(importExportInput.value);
		if (!nextSettings) {
			showStatus("Invalid JSON settings.");
			return;
		}

		renderSettingsForm(nextSettings);
		await persistSettings(nextSettings, "Imported settings applied.");
	}

	async function importSettingsFromFile(): Promise<void> {
		if (!importFileInput) {
			return;
		}

		const file = importFileInput.files?.[0];
		if (!file) {
			return;
		}

		const text = await file.text();
		const nextSettings = parseImportedSettings(text);
		importFileInput.value = "";

		if (!nextSettings) {
			showStatus("Selected file has invalid JSON.");
			return;
		}

		setImportEditorVisible(true);
		renderSettingsForm(nextSettings);
		await persistSettings(nextSettings, `Imported ${file.name}.`);
	}

	function exportSettings(): void {
		const settings = collectSettingsFromForm();
		const serialized = serializeSettings(settings);

		if (importExportInput) {
			importExportInput.value = serialized;
			setImportEditorVisible(true);
			importExportInput.select();
		}

		const blob = new Blob([serialized], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "adcheck-settings.json";
		anchor.click();
		URL.revokeObjectURL(url);

		showStatus("Settings exported.");
	}

	function collectSettingsFromForm(): Settings {
		const base = AdCheckShared.cloneDefaultSettings();

		if (enabledToggle) {
			base.enabled = enabledToggle.checked;
		}

		for (const section of AdCheckShared.SETTINGS_SECTIONS) {
			const inputs = Array.from(
				document.querySelectorAll<HTMLInputElement>(`input[data-section-key="${section.key}"]`),
			);
			base[section.key] = AdCheckShared.normalizeEntries(
				inputs.map((input) => input.value),
				[],
			);
		}

		return base;
	}

	async function loadSettings(): Promise<Settings> {
		try {
			const result = await chrome.storage.sync.get(AdCheckShared.STORAGE_KEY);
			return AdCheckShared.mergeSettings(
				result[AdCheckShared.STORAGE_KEY] as Partial<Settings> | undefined,
			);
		} catch (error: unknown) {
			if (isExtensionContextInvalidatedError(error)) {
				showStatus("Extension reloaded. Reopen the popup.");
				return AdCheckShared.cloneDefaultSettings();
			}

			throw error;
		}
	}

	function showStatus(message: string): void {
		if (!statusMessage) {
			return;
		}

		statusMessage.textContent = message;
		window.setTimeout(() => {
			if (statusMessage.textContent === message) {
				statusMessage.textContent = "";
			}
		}, 1800);
	}

	function populateImportExportInput(settings: Settings): void {
		if (!importExportInput) {
			return;
		}

		importExportInput.value = serializeSettings(settings);
	}

	function parseImportedSettings(value: string): Settings | null {
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}

		try {
			return AdCheckShared.mergeSettings(JSON.parse(trimmed) as Partial<Settings>);
		} catch {
			return null;
		}
	}

	function serializeSettings(settings: Settings): string {
		return JSON.stringify(settings, null, 2);
	}

	function isExtensionContextInvalidatedError(error: unknown): boolean {
		return error instanceof Error && error.message.includes("Extension context invalidated");
	}

	function isImportEditorVisible(): boolean {
		return importExportEditor?.classList.contains("is-hidden") === false;
	}

	function setImportEditorVisible(isVisible: boolean, focusEditor = false): void {
		if (!importExportEditor || !toggleImportEditorButton) {
			return;
		}

		importExportEditor.classList.toggle("is-hidden", !isVisible);
		toggleImportEditorButton.textContent = isVisible ? "Hide editor" : "Show editor";

		if (isVisible && focusEditor) {
			importExportInput?.focus();
		}
	}

	function isSiteOverrideEditorVisible(): boolean {
		return siteOverrideEditor?.classList.contains("is-hidden") === false;
	}

	function setSiteOverrideEditorVisible(isVisible: boolean): void {
		if (!siteOverrideEditor || !toggleSiteOverrideEditorButton) {
			return;
		}

		siteOverrideEditor.classList.toggle("is-hidden", !isVisible);
		toggleSiteOverrideEditorButton.textContent = isVisible ? "Hide details" : "Show details";
	}

	function escapeHtml(value: string): string {
		return value
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;")
			.replaceAll("'", "&#39;");
	}
})();
