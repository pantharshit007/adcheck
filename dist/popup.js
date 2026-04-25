"use strict";
/// <reference path="./shared/types.ts" />
(() => {
    const formRoot = document.getElementById("settingsForm");
    const saveButton = document.getElementById("saveButton");
    const resetDefaultsButton = document.getElementById("resetDefaultsButton");
    const enabledToggle = document.getElementById("enabledToggle");
    const statusMessage = document.getElementById("statusMessage");
    void initializePopup();
    async function initializePopup() {
        if (!formRoot || !saveButton || !resetDefaultsButton || !enabledToggle || !statusMessage) {
            return;
        }
        const settings = await loadSettings();
        renderSettingsForm(settings);
        saveButton.addEventListener("click", () => {
            void saveSettings();
        });
        enabledToggle.addEventListener("change", () => {
            void persistEnabledState();
        });
        resetDefaultsButton.addEventListener("click", () => {
            const defaults = AdCheckShared.cloneDefaultSettings();
            renderSettingsForm(defaults);
            void persistSettings(defaults, "Defaults restored.");
        });
    }
    function renderSettingsForm(settings) {
        if (!formRoot || !enabledToggle) {
            return;
        }
        enabledToggle.checked = settings.enabled;
        formRoot.innerHTML = AdCheckShared.SETTINGS_SECTIONS.map((section) => renderSection(section, settings)).join("");
        bindSectionActions();
    }
    function renderSection(section, settings) {
        const values = settings[section.key];
        const rows = (values.length > 0 ? values : [""])
            .map((value, index) => `
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
        `)
            .join("");
        return `
      <section class="adcheck-config-section" data-section="${section.key}">
        <div class="adcheck-config-section-header">
          <div>
            <p class="adcheck-section-title">${escapeHtml(section.title)}</p>
            <p class="adcheck-section-copy">${escapeHtml(section.description)}</p>
          </div>
          <button class="adcheck-add-button" type="button" data-add-row="${section.key}">Add</button>
        </div>
        <div class="adcheck-entry-list" data-entry-list="${section.key}">
          ${rows}
        </div>
      </section>
    `;
    }
    function bindSectionActions() {
        if (!formRoot) {
            return;
        }
        for (const button of Array.from(formRoot.querySelectorAll("[data-add-row]"))) {
            button.addEventListener("click", () => {
                addRow(button.dataset.addRow ?? "");
            });
        }
        for (const button of Array.from(formRoot.querySelectorAll("[data-remove-row]"))) {
            button.addEventListener("click", () => {
                removeRow(button);
            });
        }
    }
    function addRow(sectionKey) {
        if (!formRoot) {
            return;
        }
        const list = formRoot.querySelector(`[data-entry-list="${sectionKey}"]`);
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
        wrapper.querySelector(".adcheck-entry-input")?.focus();
        wrapper.querySelector("[data-remove-row]")?.addEventListener("click", () => {
            removeRow(wrapper.querySelector("[data-remove-row]"));
        });
    }
    function removeRow(button) {
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
    async function saveSettings() {
        const settings = collectSettingsFromForm();
        await persistSettings(settings, "Settings saved.");
    }
    async function persistEnabledState() {
        const settings = collectSettingsFromForm();
        await persistSettings(settings, settings.enabled ? "AdCheck enabled." : "AdCheck disabled.");
    }
    async function persistSettings(settings, message) {
        await chrome.storage.sync.set({
            [AdCheckShared.STORAGE_KEY]: settings
        });
        renderSettingsForm(settings);
        showStatus(message);
    }
    function collectSettingsFromForm() {
        const base = AdCheckShared.cloneDefaultSettings();
        if (enabledToggle) {
            base.enabled = enabledToggle.checked;
        }
        for (const section of AdCheckShared.SETTINGS_SECTIONS) {
            const inputs = Array.from(document.querySelectorAll(`input[data-section-key="${section.key}"]`));
            base[section.key] = AdCheckShared.normalizeEntries(inputs.map((input) => input.value), []);
            if (base[section.key].length === 0) {
                base[section.key] = [...AdCheckShared.DEFAULT_SETTINGS[section.key]];
            }
        }
        return base;
    }
    async function loadSettings() {
        const result = await chrome.storage.sync.get(AdCheckShared.STORAGE_KEY);
        return AdCheckShared.mergeSettings(result[AdCheckShared.STORAGE_KEY]);
    }
    function showStatus(message) {
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
    function escapeHtml(value) {
        return value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }
})();
