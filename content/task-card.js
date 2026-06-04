"use strict";

const CONTENT_DEFAULT_BLOCKS = {};

const LEGACY_GROUP_TOGGLES = {
  "user-fields": "userFields",
  placements: "placements",
};

const LEGACY_ITEM_KEYS = {
  "user-fields::эйзенхауэр (1-4)": "eisenhower",
  "user-fields::мяч у": "ball",
  "user-fields::последний комментарий": "comment",
  "placements::показать поля": "showFields",
  "placements::управление задачей": "taskManage",
  "placements::результаты задачи в ус": "resultsUs",
  "placements::кнопка \"готово\"": "doneBtn",
  "placements::готово": "doneBtn",
  "placements::!главное": "main",
  "placements::база знаний": "knowledge",
  "placements::запуск бп": "bpStart",
  "placements::запустить бп": "bpRun",
};

const RIGHT_MENU_TITLE_SELECTORS = [
  ".tasks-field-files-title",
  ".tasks-field-results-title",
  ".tasks-field-title",
  ".ui-entity-editor-block-title-text",
  ".ui-entity-editor-section-title-text",
  ".b24-field-list-title",
];

const TRANSIENT_BLOCK_TITLES = [
  "приложение загружается",
  "загрузка",
  "loading",
  "please wait",
];

const SELECTORS = {
  card: ".tasks-full-card",
  main: ".tasks-full-card-main",
  chat: ".tasks-full-card-chat",
  content: ".tasks-full-card-content",
  header: ".tasks-full-card-header",
  description: ".tasks-card-description-field",
  fields: ".tasks-full-card-fields",
  fieldContainer: ".tasks-full-card-field-container",
  footer: ".tasks-full-card-footer",
  footerEdit: ".tasks-full-card-footer-edit",
  footerCreate: ".tasks-full-card-footer-create",
  chips: ".tasks-full-card-chips",
  chipsFields: ".tasks-full-card-chips-fields",
  userFieldsContainer: ".tasks-field-user-fields",
  placementsList: ".tasks-field-placements-list",
};

const STORAGE_KEY_CHAT = "btc-chat-drawer-open";
const STORAGE_KEY_BLOCKS = "btc_blocks";
const STORAGE_KEY_SETTINGS_REGISTRY = "btc_settings_registry";
const STORAGE_KEY_CHECKLIST_HEIGHT = "btc-checklist-height";
const STORAGE_KEY_CHECKLIST_COLLAPSED = "btc-checklist-collapsed";
const STORAGE_KEY_UPDATE_STATE = "btc_update_state";
const STORAGE_KEY_UPDATE_DISMISSED_VERSION = "btc_update_dismissed_version";
const RESIZER_BIND_VERSION = "v2";
const CHECKLIST_TOGGLE_BIND_VERSION = "v1";
const CHECKLIST_INIT_RETRY_DELAY = 250;
const CHECKLIST_INIT_MAX_RETRIES = 20;
const ENABLE_RUNTIME_LOGS = false;

function logMessage(...args) {
  if (!ENABLE_RUNTIME_LOGS) {
    return;
  }

  console.log("[BTC]", ...args);
}

function isBitrixTaskContext() {
  const href = window.location.href;

  if (
    href.includes("/tasks/task/view/") ||
    href.includes("/tasks/task/edit/") ||
    href.includes("/tasks/task/")
  ) {
    return true;
  }

  return Boolean(
    document.querySelector(".tasks-full-card") ||
      document.querySelector(".tasks-full-card-main") ||
      document.querySelector(".tasks-full-card-content"),
  );
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (element) {
        observer.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for ${selector}`));
    }, timeout);
  });
}

function isChatDrawerOpen() {
  return localStorage.getItem(STORAGE_KEY_CHAT) === "true";
}

function setChatDrawerOpen(isOpen) {
  localStorage.setItem(STORAGE_KEY_CHAT, String(isOpen));
}

function getStoredChecklistHeight() {
  const value = Number(localStorage.getItem(STORAGE_KEY_CHECKLIST_HEIGHT));
  return Number.isFinite(value) && value > 0 ? value : 260;
}

function setStoredChecklistHeight(value) {
  localStorage.setItem(STORAGE_KEY_CHECKLIST_HEIGHT, String(Math.round(value)));
}

function isStoredChecklistCollapsed() {
  return localStorage.getItem(STORAGE_KEY_CHECKLIST_COLLAPSED) === "true";
}

function setStoredChecklistCollapsed(collapsed) {
  localStorage.setItem(STORAGE_KEY_CHECKLIST_COLLAPSED, String(Boolean(collapsed)));
}

function captureChecklistTransition(label) {
  window.__btcChecklistDebugHook?.captureTransition?.(label);
}

function normalizeSettingLabel(label) {
  return String(label || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ru-RU");
}

function hashSettingLabel(label) {
  let hash = 0;
  const source = String(label || "");

  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 31) + source.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}

function isLegacyDynamicSpecialSettingsGroupTitle(title) {
  const normalized = normalizeSettingLabel(title);

  return (
    /^результат\s+от\b/.test(normalized) ||
    ((normalized.includes("соисполнители") || normalized.includes("наблюдател")) &&
      normalized !== normalizeSettingLabel("Соисполнители / Наблюдатели"))
  );
}

function getCurrentExtensionVersionName() {
  const manifest = chrome.runtime.getManifest();
  return manifest.version_name || manifest.version;
}

function chromeStorageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

function chromeStorageSet(value) {
  return new Promise((resolve) => {
    chrome.storage.local.set(value, resolve);
  });
}

async function getDismissedUpdateVersion() {
  const stored = await chromeStorageGet([STORAGE_KEY_UPDATE_DISMISSED_VERSION]);
  return stored[STORAGE_KEY_UPDATE_DISMISSED_VERSION] || "";
}

function dismissUpdateVersion(version) {
  if (!version) {
    return Promise.resolve();
  }

  return chromeStorageSet({ [STORAGE_KEY_UPDATE_DISMISSED_VERSION]: version });
}

async function getLatestUpdateInfo(options = {}) {
  const stored = await chromeStorageGet([STORAGE_KEY_UPDATE_STATE]);
  const cachedState = stored[STORAGE_KEY_UPDATE_STATE] || null;

  if (!options.force && cachedState) {
    return cachedState;
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "btc-check-updates", force: options.force === true }, (response) => {
      if (chrome.runtime.lastError || !response?.ok) {
        resolve(cachedState);
        return;
      }

      resolve(response.updateInfo || cachedState);
    });
  });
}

function createUpdatePopup(updateInfo) {
  const overlay = document.createElement("div");
  overlay.className = "btc-update-overlay --visible";

  const modal = document.createElement("div");
  modal.className = "btc-update-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Доступно обновление расширения");

  const title = document.createElement("h2");
  title.className = "btc-update-modal__title";
  title.textContent = "Доступно обновление";

  const message = document.createElement("p");
  message.className = "btc-update-modal__message";
  message.append("Вышла новая версия расширения ");

  const version = document.createElement("strong");
  version.textContent = updateInfo.versionName;
  message.append(version);
  message.append(". Для обновления воспользуйтесь файлом ");

  const updateFile = document.createElement("code");
  updateFile.textContent = "update.bat";
  message.append(updateFile);
  message.append(" в каталоге расширения или скачайте последнюю версию ");

  const releaseLink = document.createElement("a");
  releaseLink.href = updateInfo.releaseUrl;
  releaseLink.target = "_blank";
  releaseLink.rel = "noopener noreferrer";
  releaseLink.textContent = "тут";
  message.append(releaseLink);
  message.append(". Далее обновите расширение через панель расширений вашего браузера: ");

  const chromeExtensions = document.createElement("code");
  chromeExtensions.textContent = "chrome://extensions/";
  message.append(chromeExtensions);
  message.append(".");

  const actions = document.createElement("div");
  actions.className = "btc-update-modal__actions";

  const releaseButton = document.createElement("button");
  releaseButton.type = "button";
  releaseButton.className = "btc-update-modal__primary";
  releaseButton.textContent = "Открыть релиз";

  const laterButton = document.createElement("button");
  laterButton.type = "button";
  laterButton.className = "btc-update-modal__secondary";
  laterButton.textContent = "Позже";

  const closePopup = async () => {
    await dismissUpdateVersion(updateInfo.version);
    overlay.remove();
  };

  releaseButton.addEventListener("click", async () => {
    window.open(updateInfo.releaseUrl, "_blank", "noopener,noreferrer");
    await closePopup();
  });

  laterButton.addEventListener("click", closePopup);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closePopup();
    }
  });

  actions.appendChild(releaseButton);
  actions.appendChild(laterButton);
  modal.appendChild(title);
  modal.appendChild(message);
  modal.appendChild(actions);
  overlay.appendChild(modal);

  return overlay;
}

async function showUpdateNotice(updateInfo) {
  if (!updateInfo?.hasUpdate || !updateInfo.releaseUrl || document.querySelector(".btc-update-overlay")) {
    return;
  }

  if ((await getDismissedUpdateVersion()) === updateInfo.version) {
    return;
  }

  document.body.appendChild(createUpdatePopup(updateInfo));
}

async function checkForExtensionUpdate() {
  const updateInfo = await getLatestUpdateInfo();
  if (updateInfo?.hasUpdate) {
    await showUpdateNotice(updateInfo);
  }

  return updateInfo;
}

function createEmptySettingsRegistry() {
  return {
    groups: [],
  };
}

function normalizeSettingsRegistry(registry) {
  const nextRegistry = createEmptySettingsRegistry();
  const storedGroups = Array.isArray(registry?.groups) ? registry.groups : [];

  storedGroups.forEach((storedGroup) => {
    const groupId = String(storedGroup?.id || "").trim();
    const title = String(storedGroup?.title || "").replace(/\s+/g, " ").trim();
    const toggle = String(storedGroup?.toggle || "").trim();
    if (!groupId || !title || !toggle || isLegacyDynamicSpecialSettingsGroupTitle(title)) {
      return;
    }

    const dedupeKeys = new Set();
    const dedupeLabels = new Set();
    const sourceItems = Array.isArray(storedGroup?.items) ? storedGroup.items : [];
    const group = { id: groupId, title, toggle, items: [] };

    sourceItems.forEach((item) => {
      const label = String(item?.label || "").replace(/\s+/g, " ").trim();
      const normalizedLabel = normalizeSettingLabel(label);
      if (!label || !normalizedLabel || dedupeLabels.has(normalizedLabel)) {
        return;
      }

      const key = String(item?.key || "").trim() || `${groupId}_item_${hashSettingLabel(normalizedLabel)}`;
      if (dedupeKeys.has(key)) {
        return;
      }

      dedupeKeys.add(key);
      dedupeLabels.add(normalizedLabel);
      group.items.push({ key, label });
    });

    nextRegistry.groups.push(group);
  });

  return nextRegistry;
}

function getSettingsRegistrySync() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SETTINGS_REGISTRY);
    return normalizeSettingsRegistry(stored ? JSON.parse(stored) : null);
  } catch {
    return createEmptySettingsRegistry();
  }
}

function saveSettingsRegistry(registry) {
  const nextRegistry = normalizeSettingsRegistry(registry);

  try {
    localStorage.setItem(STORAGE_KEY_SETTINGS_REGISTRY, JSON.stringify(nextRegistry));
  } catch {}

  const chromeApi = typeof chrome !== "undefined" ? chrome : null;
  if (chromeApi?.storage?.local) {
    chromeApi.storage.local.set({ [STORAGE_KEY_SETTINGS_REGISTRY]: nextRegistry });
  }

  return nextRegistry;
}

function clearSettingsRegistry() {
  try {
    localStorage.removeItem(STORAGE_KEY_SETTINGS_REGISTRY);
  } catch {}

  const chromeApi = typeof chrome !== "undefined" ? chrome : null;
  if (chromeApi?.storage?.local) {
    chromeApi.storage.local.remove(STORAGE_KEY_SETTINGS_REGISTRY);
  }

  return createEmptySettingsRegistry();
}

function getBlockSettingsDefaults(registry = getSettingsRegistrySync()) {
  const defaults = { ...CONTENT_DEFAULT_BLOCKS };

  registry.groups.forEach((group) => {
    defaults[group.toggle] = defaults[group.toggle] ?? true;
    group.items.forEach((item) => {
      defaults[item.key] = defaults[item.key] ?? true;
    });
  });

  return defaults;
}

function buildStoredSettings(rawSettings, registry = getSettingsRegistrySync()) {
  return {
    ...getBlockSettingsDefaults(registry),
    ...(rawSettings || {}),
  };
}

function getTextContent(node) {
  return String(node?.textContent || "").replace(/\s+/g, " ").trim();
}

function isTransientBlockTitle(text) {
  const normalized = normalizeSettingLabel(text);
  return !normalized || TRANSIENT_BLOCK_TITLES.includes(normalized);
}

function getVisibleFieldRows(fieldList) {
  if (!fieldList) {
    return [];
  }

  return [...fieldList.querySelectorAll(":scope > .b24-field-list-row")].filter((row) => {
    const title = getTextContent(row.querySelector(".b24-field-list-title"));
    const value = getTextContent(row.querySelector(".b24-field-list-value"));
    return Boolean(title || value);
  });
}

function resolveGroupToggleKey(areaType, areaTitle) {
  if (LEGACY_GROUP_TOGGLES[areaType]) {
    return LEGACY_GROUP_TOGGLES[areaType];
  }

  return `group_${hashSettingLabel(`${areaType}::${normalizeSettingLabel(areaTitle)}`)}`;
}

function resolveSettingsGroupKey(areaType, areaTitle) {
  return `${areaType}_${hashSettingLabel(normalizeSettingLabel(areaTitle))}`;
}

function resolveSettingItemKey(groupId, label, areaType = "") {
  const normalizedLabel = normalizeSettingLabel(label);
  const legacyKey = LEGACY_ITEM_KEYS[`${areaType}::${normalizedLabel}`];
  if (legacyKey) {
    return legacyKey;
  }

  return `${groupId}_item_${hashSettingLabel(normalizedLabel)}`;
}

function buildSingleItemArea(container, areaType, areaTitle) {
  const groupId = resolveSettingsGroupKey(areaType, areaTitle);

  return {
    id: groupId,
    title: areaTitle,
    toggle: resolveGroupToggleKey(areaType, areaTitle),
    areaType,
    containerNode: container,
    items: [{
      key: resolveSettingItemKey(groupId, areaTitle, areaType),
      label: areaTitle,
      node: container,
    }],
  };
}

function scanStableSpecialArea(container) {
  if (!container) {
    return null;
  }

  if (container.querySelector(":scope .tasks-field-results")) {
    return buildSingleItemArea(container, "results", "Результаты");
  }

  if (container.querySelector(":scope .tasks-field-files")) {
    return buildSingleItemArea(container, "files", "Файлы");
  }

  const containerText = getTextContent(container);
  if (containerText.includes("Соисполнители") || containerText.includes("Наблюдател")) {
    const groupTitle = "Соисполнители / Наблюдатели";
    const groupId = resolveSettingsGroupKey("participants", groupTitle);
    const fieldRows = getVisibleFieldRows(container.querySelector(":scope .b24-field-list"));
    const items = fieldRows
      .map((node) => {
        const label = getTextContent(node.querySelector(".b24-field-list-title"));
        return label ? { key: resolveSettingItemKey(groupId, label, "participants"), label, node } : null;
      })
      .filter(Boolean);

    return {
      id: groupId,
      title: groupTitle,
      toggle: resolveGroupToggleKey("participants", groupTitle),
      areaType: "participants",
      containerNode: container,
      items: items.length ? items : [{
        key: resolveSettingItemKey(groupId, groupTitle, "participants"),
        label: groupTitle,
        node: container,
      }],
    };
  }

  return null;
}

function extractSettingItemLabel(item, options = {}) {
  if (!item) {
    return "";
  }

  const labelNode = options.labelSelector ? item.querySelector(options.labelSelector) : null;
  const rawLabel = labelNode?.textContent || item.textContent || "";
  return rawLabel.replace(/\s+/g, " ").trim();
}

function deriveAreaTitleFromContainer(container, zone) {
  if (!container) {
    return "";
  }

  if (container.querySelector(".tasks-field-user-fields")) {
    return "Пользовательские поля";
  }

  if (container.querySelector(".tasks-field-placements-list")) {
    return "Кнопки";
  }

  const fieldList = container.querySelector(":scope .b24-field-list");
  const rowTitles = getVisibleFieldRows(fieldList)
    .map((row) => getTextContent(row.querySelector(".b24-field-list-title")))
    .filter(Boolean);

  if (zone === "main" && rowTitles.length) {
    return "Основные поля";
  }

  if (rowTitles.length) {
    return rowTitles.slice(0, 2).join(" / ");
  }

  for (const selector of RIGHT_MENU_TITLE_SELECTORS) {
    const title = getTextContent(container.querySelector(selector));
    if (title && !isTransientBlockTitle(title)) {
      return title;
    }
  }

  const rawText = getTextContent(container);
  const fallbackTitle = rawText.split(/(?<=[.!?])\s+|\s{2,}/).find(Boolean)?.slice(0, 80) || "";
  if (fallbackTitle && !isTransientBlockTitle(fallbackTitle)) {
    return fallbackTitle;
  }

  return zone === "main" ? "Основные поля" : "";
}

function scanChipsNavigationArea(card) {
  const chips = card?.querySelector(SELECTORS.chips);
  if (!chips) {
    return null;
  }

  const items = [...chips.querySelectorAll(":scope > *")]
    .map((node) => {
      const label = getTextContent(node);
      return label && !isTransientBlockTitle(label)
        ? {
            key: resolveSettingItemKey("chips-navigation", label, "chips-navigation"),
            label,
            node,
          }
        : null;
    })
    .filter(Boolean);

  if (!items.length) {
    return null;
  }

  return {
    id: "chips-navigation",
    title: "Кнопки отображения элементов",
    toggle: "chipsNavigation",
    areaType: "chips-navigation",
    containerNode: chips,
    items,
  };
}

function scanRightMenuArea(container, zone) {
  if (!container) {
    return null;
  }

  const stableSpecialArea = scanStableSpecialArea(container);
  if (stableSpecialArea) {
    return stableSpecialArea;
  }

  const userFieldsRoot = container.querySelector(":scope .tasks-field-user-fields");
  if (userFieldsRoot) {
    const areaTitle = "Пользовательские поля";
    const groupId = resolveSettingsGroupKey("user-fields", areaTitle);
    const items = [...userFieldsRoot.querySelectorAll(".tasks-user-field")]
      .map((node) => {
        const label = extractSettingItemLabel(node, { labelSelector: ".tasks-user-field-title" });
        return label
          ? { key: resolveSettingItemKey(groupId, label, "user-fields"), label, node }
          : null;
      })
      .filter(Boolean);

    return {
      id: groupId,
      title: areaTitle,
      toggle: resolveGroupToggleKey("user-fields", areaTitle),
      areaType: "user-fields",
      containerNode: container,
      items,
    };
  }

  const placementsRoot = container.querySelector(":scope .tasks-field-placements-list");
  if (placementsRoot) {
    const areaTitle = "Кнопки";
    const groupId = resolveSettingsGroupKey("placements", areaTitle);
    const items = [...placementsRoot.querySelectorAll(".tasks-field-placement-item")]
      .map((node) => {
        const label = extractSettingItemLabel(node, {
          labelSelector: ".tasks-field-placement-item-title-container, .tasks-field-placement-item-header",
        });
        return label
          ? { key: resolveSettingItemKey(groupId, label, "placements"), label, node }
          : null;
      })
      .filter(Boolean);

    return {
      id: groupId,
      title: areaTitle,
      toggle: resolveGroupToggleKey("placements", areaTitle),
      areaType: "placements",
      containerNode: container,
      items,
    };
  }

  const fieldList = container.querySelector(":scope .b24-field-list");
  const fieldRows = getVisibleFieldRows(fieldList);
  if (fieldRows.length) {
    const areaTitle = deriveAreaTitleFromContainer(container, zone);
    const groupId = resolveSettingsGroupKey(zone === "main" ? "main-fields" : "field-list", areaTitle);
    const items = fieldRows
      .map((node) => {
        const label = getTextContent(node.querySelector(".b24-field-list-title")) || getTextContent(node);
        return label
          ? { key: resolveSettingItemKey(groupId, label, zone === "main" ? "main-fields" : "field-list"), label, node }
          : null;
      })
      .filter(Boolean);

    return {
      id: groupId,
      title: areaTitle,
      toggle: resolveGroupToggleKey(zone === "main" ? "main-fields" : "field-list", areaTitle),
      areaType: zone === "main" ? "main-fields" : "field-list",
      containerNode: container,
      items,
    };
  }

  const areaTitle = deriveAreaTitleFromContainer(container, zone);
  if (!areaTitle || isTransientBlockTitle(areaTitle)) {
    return null;
  }

  const customCandidates = [
    ".tasks-field-results",
    ".tasks-field-files",
    ".ui-entity-editor-content-block",
    ".ui-entity-editor-section",
    "[data-b24-crm-plugin]",
    "[data-b24-app-block]",
  ];

  const hasRecognizableCustomStructure = customCandidates.some((selector) => container.querySelector(selector));
  if (!hasRecognizableCustomStructure) {
    return null;
  }

  const groupId = resolveSettingsGroupKey("custom-block", areaTitle);
  return {
    id: groupId,
    title: areaTitle,
    toggle: resolveGroupToggleKey("custom-block", areaTitle),
    areaType: "custom-block",
    containerNode: container,
    items: [{
      key: resolveSettingItemKey(groupId, areaTitle, "custom-block"),
      label: areaTitle,
      node: container,
    }],
  };
}

function scanRightMenuAreas(card) {
  if (!card) {
    return [];
  }

  const fields = card.querySelector(SELECTORS.fields);
  const chipsFields = card.querySelector(SELECTORS.chipsFields);
  if (!fields) {
    return [];
  }

  const areas = [];
  const directMainContainers = [...fields.querySelectorAll(":scope > .tasks-full-card-field-container")];
  const directChipContainers = chipsFields
    ? [...chipsFields.querySelectorAll(":scope > .tasks-full-card-field-container")]
    : [];

  directMainContainers.forEach((container) => {
    const area = scanRightMenuArea(container, "main");
    if (area) {
      areas.push(area);
    }
  });

  directChipContainers.forEach((container) => {
    const area = scanRightMenuArea(container, "chips");
    if (area) {
      areas.push(area);
    }
  });

  const chipsNavigationArea = scanChipsNavigationArea(card);
  if (chipsNavigationArea) {
    areas.push(chipsNavigationArea);
  }

  return areas;
}

function collectSettingsRegistryFromCard(card) {
  const registry = createEmptySettingsRegistry();

  scanRightMenuAreas(card).forEach((area) => {
    const seenLabels = new Set();
    const group = {
      id: area.id,
      title: area.title,
      toggle: area.toggle,
      items: [],
    };

    area.items.forEach((item) => {
      const normalizedLabel = normalizeSettingLabel(item.label);
      if (!item.label || seenLabels.has(normalizedLabel)) {
        return;
      }

      seenLabels.add(normalizedLabel);
      group.items.push({ key: item.key, label: item.label });
    });

    if (group.items.length) {
      registry.groups.push(group);
    }
  });

  return registry;
}

function mergeSettingsRegistries(baseRegistry, additionalRegistry) {
  const nextRegistry = normalizeSettingsRegistry(baseRegistry);
  const sourceRegistry = normalizeSettingsRegistry(additionalRegistry);

  sourceRegistry.groups.forEach((sourceGroup) => {
    let targetGroup = nextRegistry.groups.find((group) => group.id === sourceGroup.id);
    if (!targetGroup) {
      targetGroup = {
        id: sourceGroup.id,
        title: sourceGroup.title,
        toggle: sourceGroup.toggle,
        items: [],
      };
      nextRegistry.groups.push(targetGroup);
    }

    const existingKeys = new Set(targetGroup.items.map((item) => item.key));
    const existingLabels = new Set(targetGroup.items.map((item) => normalizeSettingLabel(item.label)));

    sourceGroup.items.forEach((item) => {
      const normalizedLabel = normalizeSettingLabel(item.label);
      if (!item.key || !item.label || existingKeys.has(item.key) || existingLabels.has(normalizedLabel)) {
        return;
      }

      targetGroup.items.push({ key: item.key, label: item.label });
      existingKeys.add(item.key);
      existingLabels.add(normalizedLabel);
    });
  });

  return nextRegistry;
}

function syncSettingsRegistryFromCard(card) {
  const detectedRegistry = collectSettingsRegistryFromCard(card);
  const storedRegistry = getSettingsRegistrySync();
  const nextRegistry = mergeSettingsRegistries(storedRegistry, detectedRegistry);

  if (JSON.stringify(nextRegistry) !== JSON.stringify(storedRegistry)) {
    saveSettingsRegistry(nextRegistry);
  }

  return nextRegistry;
}

function syncSettingsRegistryFromAllCards() {
  const scannedRegistry = getTaskCards().reduce((registry, card) => {
    const detectedRegistry = collectSettingsRegistryFromCard(card);
    return mergeSettingsRegistries(registry, detectedRegistry);
  }, createEmptySettingsRegistry());

  return mergeSettingsRegistries(scannedRegistry, getSettingsRegistrySync());
}

function getBlockSettings() {
  return new Promise((resolve) => {
    const chromeAny = chrome;

    if (chromeAny && chromeAny.storage) {
      chromeAny.storage.local.get([STORAGE_KEY_BLOCKS, STORAGE_KEY_SETTINGS_REGISTRY], (result) => {
        const registry = normalizeSettingsRegistry(result[STORAGE_KEY_SETTINGS_REGISTRY]);
        const settings = buildStoredSettings(result[STORAGE_KEY_BLOCKS], registry);

        try {
          localStorage.setItem(STORAGE_KEY_BLOCKS, JSON.stringify(settings));
          localStorage.setItem(STORAGE_KEY_SETTINGS_REGISTRY, JSON.stringify(registry));
        } catch {}

        resolve(settings);
      });

      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY_BLOCKS);
      resolve(buildStoredSettings(stored ? JSON.parse(stored) : {}, getSettingsRegistrySync()));
    } catch {
      resolve(buildStoredSettings({}, getSettingsRegistrySync()));
    }
  });
}

function getBlockSettingsSync() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_BLOCKS);
    return buildStoredSettings(stored ? JSON.parse(stored) : {}, getSettingsRegistrySync());
  } catch {
    return buildStoredSettings({}, getSettingsRegistrySync());
  }
}

function saveBlockSettings(settings) {
  const nextSettings = buildStoredSettings(settings || {}, getSettingsRegistrySync());

  try {
    localStorage.setItem(STORAGE_KEY_BLOCKS, JSON.stringify(nextSettings));
  } catch {}

  const chromeApi = typeof chrome !== "undefined" ? chrome : null;
  if (chromeApi?.storage?.local) {
    chromeApi.storage.local.set({ [STORAGE_KEY_BLOCKS]: nextSettings });
  }

  document.querySelectorAll(SELECTORS.card).forEach((card) => {
    if (card.classList.contains("btc-layout-applied")) {
      applyVisibilitySettings(card, nextSettings);
    }
  });

  return nextSettings;
}

function promoteGroupsWithNewItems(settings, previousRegistry, nextRegistry) {
  const nextSettings = { ...(settings || {}) };
  let changed = false;

  nextRegistry.groups.forEach((group) => {
    if (nextSettings[group.toggle] !== false) {
      return;
    }

    const previousGroup = previousRegistry.groups.find((entry) => entry.id === group.id);
    if (!previousGroup?.items?.length) {
      return;
    }

    const previousKeys = new Set(previousGroup.items.map((item) => item.key));
    const hasNewItems = group.items.some((item) => !previousKeys.has(item.key));
    if (!hasNewItems) {
      return;
    }

    nextSettings[group.toggle] = true;
    previousGroup.items.forEach((item) => {
      if (item?.key) {
        nextSettings[item.key] = false;
      }
    });
    changed = true;
  });

  return changed ? nextSettings : settings;
}

function resetBlockSettingsToDefaults() {
  const defaults = buildStoredSettings({}, getSettingsRegistrySync());
  return saveBlockSettings(defaults);
}

function refreshAllAppliedCards() {
  const settings = getBlockSettingsSync();
  document.querySelectorAll(SELECTORS.card).forEach((card) => {
    if (card.classList.contains("btc-layout-applied")) {
      applyVisibilitySettings(card, settings);
    }
  });
}

function getTaskCards() {
  return [...document.querySelectorAll(SELECTORS.card)];
}

async function applyLayoutToPendingCards() {
  const cards = getTaskCards();

  for (const card of cards) {
    if (!(card instanceof HTMLElement)) {
      continue;
    }

    if (card.classList.contains("btc-layout-applied") || card.dataset.btcLayoutApplying === "true") {
      continue;
    }

    card.dataset.btcLayoutApplying = "true";

    try {
      await applyLayout(card);
    } finally {
      delete card.dataset.btcLayoutApplying;
    }
  }

  return cards.length;
}

function createToggleInput(checked) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = checked;
  return input;
}

function ensureMainStack(content, fields) {
  if (!content || !fields) {
    return null;
  }

  let stack = content.querySelector(".btc-main-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "btc-main-stack";
    content.insertBefore(stack, fields);
  }

  return stack;
}

function ensureMainBottom(stack) {
  if (!stack) {
    return null;
  }

  let bottom = stack.querySelector(".btc-main-bottom");
  if (!bottom) {
    bottom = document.createElement("div");
    bottom.className = "btc-main-bottom";
    stack.appendChild(bottom);
  }

  return bottom;
}

function ensureDescriptionMissingPlaceholder(stack) {
  if (!stack) {
    return null;
  }

  let placeholder = stack.querySelector(":scope > .btc-main-placeholder");
  if (!placeholder) {
    placeholder = document.createElement("div");
    placeholder.className = "btc-main-placeholder";
    stack.prepend(placeholder);
  }

  return placeholder;
}

function cleanupDescriptionMissingPlaceholder(stack) {
  const placeholder = stack?.querySelector(":scope > .btc-main-placeholder");
  if (placeholder) {
    placeholder.remove();
  }
}

function syncSettingsGroupSectionState(section, toggle, items) {
  if (!section || !toggle || !items) {
    return;
  }

  const isEnabled = toggle.checked;
  section.dataset.groupEnabled = isEnabled ? "true" : "false";
  items.setAttribute("aria-hidden", isEnabled ? "false" : "true");

  const rows = [...items.querySelectorAll("input[data-setting-key]")];
  rows.forEach((input) => {
    input.disabled = !isEnabled;
  });
}

function getGroupItemInputs(items) {
  if (!items) {
    return [];
  }

  return [...items.querySelectorAll("input[data-setting-key]")];
}

function syncGroupToggleFromItems(section, groupToggle, items) {
  const itemInputs = getGroupItemInputs(items);
  const hasCheckedItems = itemInputs.some((input) => input.checked);
  groupToggle.checked = hasCheckedItems;
  syncSettingsGroupSectionState(section, groupToggle, items);
}

function enableAllGroupItems(section, groupToggle, items) {
  const itemInputs = getGroupItemInputs(items);
  itemInputs.forEach((input) => {
    input.checked = true;
  });

  groupToggle.checked = true;
  syncSettingsGroupSectionState(section, groupToggle, items);
}

function buildSettingsModalContent(settings, updateInfo = null) {
  const registry = syncSettingsRegistryFromAllCards();
  const modal = document.createElement("div");
  modal.className = "btc-settings-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", "Настройки меню задачи");

  const header = document.createElement("div");
  header.className = "btc-settings-modal__header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "btc-settings-modal__title-wrap";

  const title = document.createElement("h2");
  title.className = "btc-settings-modal__title";
  title.textContent = "Настройки меню задачи";

  const hint = document.createElement("p");
  hint.className = "btc-settings-modal__hint";
  hint.textContent = "Снимите галочку, чтобы скрыть блок в интерфейсе карточки задачи.";

  titleWrap.appendChild(title);
  titleWrap.appendChild(hint);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btc-settings-modal__close";
  closeButton.setAttribute("aria-label", "Закрыть настройки");
  closeButton.textContent = "Закрыть";

  header.appendChild(titleWrap);
  header.appendChild(closeButton);
  modal.appendChild(header);

  const body = document.createElement("div");
  body.className = "btc-settings-modal__body";

  const footer = document.createElement("div");
  footer.className = "btc-settings-modal__footer";

  const footerActions = document.createElement("div");
  footerActions.className = "btc-settings-modal__actions";

  const resetSettingsButton = document.createElement("button");
  resetSettingsButton.type = "button";
  resetSettingsButton.className = "btc-settings-modal__secondary-action";
  resetSettingsButton.textContent = "Сбросить настройки";

  const clearRegistryButton = document.createElement("button");
  clearRegistryButton.type = "button";
  clearRegistryButton.className = "btc-settings-modal__secondary-action btc-settings-modal__secondary-action--danger";
  clearRegistryButton.textContent = "Очистить реестр полей";

  const version = document.createElement("div");
  version.className = "btc-settings-modal__version";
  version.textContent = getCurrentExtensionVersionName();

  if (updateInfo?.hasUpdate && updateInfo.releaseUrl) {
    const updateStatus = document.createElement("div");
    updateStatus.className = "btc-settings-modal__update-status";

    const updateText = document.createElement("div");
    updateText.className = "btc-settings-modal__update-text";
    updateText.textContent = `Доступно обновление: ${updateInfo.versionName}`;

    const updateLink = document.createElement("button");
    updateLink.type = "button";
    updateLink.className = "btc-settings-modal__update-link";
    updateLink.textContent = "Открыть релиз";
    updateLink.addEventListener("click", () => {
      window.open(updateInfo.releaseUrl, "_blank", "noopener,noreferrer");
      dismissUpdateVersion(updateInfo.version);
    });

    updateStatus.appendChild(updateText);
    updateStatus.appendChild(updateLink);
    footer.appendChild(updateStatus);
  }

  const nextSettings = buildStoredSettings(settings, registry);

  registry.groups.forEach((group) => {
    if (!group.items.length) {
      return;
    }

    const section = document.createElement("section");
    section.className = "btc-settings-group";

    const summary = document.createElement("label");
    summary.className = "btc-settings-group__toggle";

    const groupToggle = createToggleInput(nextSettings[group.toggle]);
    groupToggle.dataset.settingKey = group.toggle;

    const groupLabel = document.createElement("span");
    groupLabel.textContent = group.title;

    summary.appendChild(groupToggle);
    summary.appendChild(groupLabel);
    section.appendChild(summary);

    const items = document.createElement("div");
    items.className = "btc-settings-group__items";

    group.items.forEach((item) => {
      const row = document.createElement("label");
      row.className = "btc-settings-group__item";

      const input = createToggleInput(nextSettings[item.key]);
      input.dataset.settingKey = item.key;

      const label = document.createElement("span");
      label.textContent = item.label;

      row.appendChild(input);
      row.appendChild(label);
      items.appendChild(row);
    });

    section.appendChild(items);
    syncSettingsGroupSectionState(section, groupToggle, items);
    body.appendChild(section);

    groupToggle.addEventListener("change", () => {
      if (groupToggle.checked) {
        enableAllGroupItems(section, groupToggle, items);
        return;
      }

      syncSettingsGroupSectionState(section, groupToggle, items);
    });

    getGroupItemInputs(items).forEach((input) => {
      input.addEventListener("change", () => {
        syncGroupToggleFromItems(section, groupToggle, items);
      });
    });
  });

  modal.appendChild(body);
  footerActions.appendChild(resetSettingsButton);
  footerActions.appendChild(clearRegistryButton);
  footer.appendChild(footerActions);
  footer.appendChild(version);
  modal.appendChild(footer);

  return { modal, closeButton, resetSettingsButton, clearRegistryButton };
}

async function openSettingsModal() {
  if (!isBitrixTaskContext()) {
    return false;
  }

  const existing = document.querySelector(".btc-settings-overlay");
  if (existing) {
    existing.classList.add("--visible");
    return true;
  }

  saveSettingsRegistry(syncSettingsRegistryFromAllCards());
  const settings = await getBlockSettings();
  const updateInfo = await getLatestUpdateInfo();
  const overlay = document.createElement("div");
  overlay.className = "btc-settings-overlay --visible";

  const { modal, closeButton, resetSettingsButton, clearRegistryButton } = buildSettingsModalContent(settings, updateInfo);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const closeModal = () => {
    overlay.remove();
    document.removeEventListener("keydown", onEscapeKeyDown, true);
    document.removeEventListener("keyup", onEscapeKeyUp, true);
  };

  const swallowEscape = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  const onEscapeKeyDown = (event) => {
    if (event.key !== "Escape") {
      return;
    }

    swallowEscape(event);
    closeModal();
  };

  const onEscapeKeyUp = (event) => {
    if (event.key === "Escape") {
      swallowEscape(event);
    }
  };

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  modal.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      swallowEscape(event);
    }
  }, true);

  modal.addEventListener("keyup", (event) => {
    if (event.key === "Escape") {
      swallowEscape(event);
    }
  }, true);

  closeButton.addEventListener("click", closeModal);
  resetSettingsButton.addEventListener("click", async () => {
    resetBlockSettingsToDefaults();
    refreshAllAppliedCards();
    closeModal();
    await openSettingsModal();
  });

  clearRegistryButton.addEventListener("click", async () => {
    clearSettingsRegistry();
    resetBlockSettingsToDefaults();
    refreshAllAppliedCards();
    closeModal();
    await openSettingsModal();
  });

  document.addEventListener("keydown", onEscapeKeyDown, true);
  document.addEventListener("keyup", onEscapeKeyUp, true);

  modal.querySelectorAll("input[data-setting-key]").forEach((input) => {
    input.addEventListener("change", () => {
      const nextSettings = getBlockSettingsSync();
      modal.querySelectorAll("input[data-setting-key]").forEach((control) => {
        nextSettings[control.dataset.settingKey] = control.checked;
      });
      saveBlockSettings(nextSettings);
    });
  });

  return true;
}

function applyVisibilitySettings(card, settings) {
  const previousRegistry = getSettingsRegistrySync();
  const registry = syncSettingsRegistryFromCard(card);
  const effectiveSettings = promoteGroupsWithNewItems(settings, previousRegistry, registry);

  if (effectiveSettings !== settings) {
    saveBlockSettings(effectiveSettings);
  }

  const areasById = new Map(scanRightMenuAreas(card).map((area) => [area.id, area]));

  registry.groups.forEach((group) => {
    const area = areasById.get(group.id);
    if (!area?.containerNode) {
      return;
    }

    area.containerNode.dataset.btcHiddenBySettings = effectiveSettings[group.toggle] === false ? "true" : "false";
    area.containerNode.style.display = effectiveSettings[group.toggle] ? "" : "none";
    if (!effectiveSettings[group.toggle]) {
      area.items.forEach((item) => {
        if (item?.node instanceof HTMLElement) {
          item.node.dataset.btcHiddenBySettings = "true";
          item.node.style.display = "none";
        }
      });
      return;
    }

    const itemsByKey = new Map(area.items.map((item) => [item.key, item]));
    group.items.forEach((item) => {
      const liveItem = itemsByKey.get(item.key);
      if (!liveItem?.node) {
        return;
      }

      liveItem.node.dataset.btcHiddenBySettings = effectiveSettings[item.key] === false ? "true" : "false";
      liveItem.node.style.display = effectiveSettings[item.key] === false ? "none" : "";
    });
  });

  normalizeRightColumnVisibility(card);
}

function setupChatDrawer(card) {
  const chat = card.querySelector(SELECTORS.chat);
  if (!chat || card.querySelector(".btc-chat-drawer")) {
    return;
  }

  const drawer = document.createElement("div");
  drawer.className = "btc-chat-drawer";

  const overlay = document.createElement("div");
  overlay.className = "btc-chat-drawer-overlay";

  const panel = document.createElement("div");
  panel.className = "btc-chat-drawer-panel";

  chat.classList.add("btc-chat-drawer-content");
  panel.appendChild(chat);
  drawer.appendChild(overlay);
  drawer.appendChild(panel);
  card.appendChild(drawer);

  const header = card.querySelector(SELECTORS.header);
  if (header && !header.querySelector(".btc-chat-toggle-header")) {
    const syncDrawerState = () => {
      drawer.classList.toggle("--open", isChatDrawerOpen());
    };

    const button = document.createElement("button");
    button.className = "btc-chat-toggle-header";
    button.textContent = "Чат";
    button.setAttribute("aria-label", "Toggle chat drawer");

    button.addEventListener("click", () => {
      setChatDrawerOpen(!isChatDrawerOpen());
      syncDrawerState();
    });

    overlay.addEventListener("click", () => {
      setChatDrawerOpen(false);
      syncDrawerState();
    });

    header.appendChild(button);
    syncDrawerState();
  }
}

function ensureSettingsHeaderButton(card) {
  const header = card.querySelector(SELECTORS.header);
  if (!header || header.querySelector(".btc-settings-button-header")) {
    return;
  }

  const isHeaderControl = (element) => {
    if (!(element instanceof Element)) {
      return false;
    }

    return Boolean(
      element.matches("button, a, [role='button'], .ui-btn") ||
        element.querySelector("button, a, [role='button'], .ui-btn"),
    );
  };

  const controlsAnchor = [...header.children].find((child) => isHeaderControl(child)) || null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btc-settings-button-header";
  button.setAttribute("aria-label", "Открыть настройки меню задачи");
  button.setAttribute("title", "Настройки меню задачи");
  button.innerHTML = '<span class="btc-settings-button-header__icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.03 7.03 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.62-.06.94s.02.63.06.94l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z" fill="currentColor"/></svg></span>';

  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSettingsModal();
  });

  if (controlsAnchor) {
    header.insertBefore(button, controlsAnchor);
    return;
  }

  header.appendChild(button);
}

function setupFieldContainers(card) {
  const fields = card.querySelector(SELECTORS.fields);
  if (!fields) return;

  fields.querySelectorAll(SELECTORS.fieldContainer).forEach((container) => {
    container.style.removeProperty("margin-bottom");
  });

  const chipsFields = card.querySelector(SELECTORS.chipsFields);
  if (chipsFields) {
    chipsFields.querySelectorAll(":scope > *").forEach((container) => {
      container.style.removeProperty("margin-bottom");
    });
  }
}

function setupChips(card) {
  const fields = card.querySelector(SELECTORS.fields);
  const chipsFields = card.querySelector(SELECTORS.chipsFields);

  if (fields && chipsFields) {
    fields.appendChild(chipsFields);
  }
}

function hasFieldRow(fieldList, titleText) {
  return [...fieldList.querySelectorAll(".b24-field-list-title")].some((title) =>
    (title.textContent || "").trim().includes(titleText),
  );
}

function findFieldRow(fieldList, titleText) {
  return [...fieldList.querySelectorAll(".b24-field-list-row")].find((row) => {
    const title = row.querySelector(".b24-field-list-title");
    return (title?.textContent || "").trim().includes(titleText);
  });
}

function moveRowToFieldList(targetList, row, position = "end", afterTitle = "") {
  if (!targetList || !row) return;

  if (position === "start") {
    targetList.insertBefore(row, targetList.firstChild);
    return;
  }

  if (position === "after" && afterTitle) {
    const anchorRow = findFieldRow(targetList, afterTitle);
    if (anchorRow && anchorRow.parentNode === targetList) {
      targetList.insertBefore(row, anchorRow.nextSibling);
      return;
    }
  }

  targetList.appendChild(row);
}

function moveCompletionDateField(targetList, sourceContainer) {
  if (!targetList || !sourceContainer) {
    return;
  }

  const existingRow = findFieldRow(targetList, "Дата завершения");
  if (existingRow?.dataset.btcCompletionInlineEdit === "true") {
    return;
  }

  const sourceWrapper = sourceContainer.querySelector(":scope > div");
  const completionFieldList = sourceContainer.querySelector(".b24-field-list");
  const completionRow = completionFieldList ? findFieldRow(completionFieldList, "Дата завершения") : null;

  if (!sourceWrapper || !completionRow) {
    return;
  }

  const targetRow = existingRow || document.createElement("div");
  if (!existingRow) {
    targetRow.className = "b24-field-list-row";
    moveRowToFieldList(targetList, targetRow, "after", "Дата создания");
  }

  let targetTitle = targetRow.querySelector(":scope > .b24-field-list-title");
  if (!targetTitle) {
    targetTitle = document.createElement("div");
    targetTitle.className = "b24-field-list-title";
    targetRow.appendChild(targetTitle);
  }

  targetTitle.textContent = "Дата завершения ";
  const titleHint = document.createElement("div");
  titleHint.className = "b24-field-list-title-hint";
  targetTitle.appendChild(titleHint);

  let targetValue = targetRow.querySelector(":scope > .b24-field-list-value");
  if (!targetValue) {
    targetValue = document.createElement("div");
    targetValue.className = "b24-field-list-value";
    targetRow.appendChild(targetValue);
  }

  targetValue.replaceChildren();
  sourceWrapper.classList.add("btc-completion-inline-shell");
  targetValue.appendChild(sourceWrapper);
  targetRow.dataset.btcCompletionInlineEdit = "true";

  sourceContainer.remove();
}

function hideEmptyFieldListRows(fieldList) {
  if (!fieldList) return;

  fieldList.querySelectorAll(".b24-field-list-row").forEach((row) => {
    const title = row.querySelector(".b24-field-list-title");
    const value = row.querySelector(".b24-field-list-value");
    const titleText = (title?.textContent || "").trim();
    const valueText = (value?.textContent || "").trim();

    if (!titleText && !valueText) {
      row.style.display = "none";
    }
  });
}

function showFieldListRows(fieldList) {
  if (!fieldList) return;

  fieldList.querySelectorAll(".b24-field-list-row").forEach((row) => {
    if (row.dataset.btcHiddenBySettings === "true") {
      row.style.display = "none";
      return;
    }

    row.style.display = "";
  });
}

function isElementVisibleForLayout(node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if (node.dataset.btcHiddenBySettings === "true" || node.style.display === "none") {
    return false;
  }

  const style = getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }

  const rect = node.getBoundingClientRect();
  return rect.height > 0 && rect.width > 0;
}

function hasVisibleFieldListRows(fieldList) {
  if (!fieldList) {
    return false;
  }

  return [...fieldList.querySelectorAll(":scope > .b24-field-list-row")].some((row) => {
    if (!isElementVisibleForLayout(row)) {
      return false;
    }

    const title = row.querySelector(".b24-field-list-title");
    const value = row.querySelector(".b24-field-list-value");
    const titleText = (title?.textContent || "").trim();
    const valueText = (value?.textContent || "").trim();
    return Boolean(titleText || valueText);
  });
}

function hasVisibleManagedChildren(node) {
  if (!(node instanceof HTMLElement) || !isElementVisibleForLayout(node)) {
    return false;
  }

  if (!node.children.length) {
    return true;
  }

  return [...node.children].some((child) => isElementVisibleForLayout(child));
}

function containerHasVisibleContent(container) {
  if (!(container instanceof HTMLElement)) {
    return false;
  }

  if (container.dataset.btcHiddenBySettings === "true") {
    return false;
  }

  const fieldList = container.querySelector(":scope .b24-field-list");
  if (hasVisibleFieldListRows(fieldList)) {
    return true;
  }

  const managedNodes = [
    container.querySelector(":scope .tasks-field-placements-list"),
    container.querySelector(":scope .tasks-field-user-fields"),
    container.querySelector(":scope .tasks-field-results"),
    container.querySelector(":scope .tasks-full-card-chips"),
    container.querySelector(":scope .tasks-field-files"),
    container.querySelector(":scope .ui-entity-editor-content-block"),
    container.querySelector(":scope .ui-entity-editor-section"),
  ];

  if (managedNodes.some((node) => hasVisibleManagedChildren(node))) {
    return true;
  }

  return [...container.children].some((child) => {
    if (!isElementVisibleForLayout(child)) {
      return false;
    }

    if (child.classList.contains("b24-field-list")) {
      return hasVisibleFieldListRows(child);
    }

    return Boolean((child.textContent || "").trim()) || child.children.length > 0;
  });
}

function hideEmptyFieldContainers(root) {
  if (!root) return;

  const directContainers = [...root.querySelectorAll(":scope > .tasks-full-card-field-container")];

  directContainers.forEach((container) => {
    if (container.dataset.btcHiddenBySettings === "true") {
      container.style.display = "none";
      return;
    }

    container.style.display = containerHasVisibleContent(container) ? "" : "none";
  });

  if (root.matches(SELECTORS.chipsFields)) {
    root.style.display = directContainers.some((container) => isElementVisibleForLayout(container)) ? "" : "none";
  }
}

function normalizeRightColumnVisibility(card) {
  const chipsFields = card?.querySelector(SELECTORS.chipsFields);
  if (chipsFields) {
    hideEmptyFieldContainers(chipsFields);
  }

  const fields = card?.querySelector(SELECTORS.fields);
  if (fields) {
    hideEmptyFieldContainers(fields);
  }
}

function findChecklistContainer(root) {
  if (!root) return null;

  return [...root.querySelectorAll(":scope > .tasks-full-card-field-container")].find((container) => {
    const text = (container.textContent || "").trim();

    return (
      text.includes("Чек-лист") ||
      text.includes("Чек-листы") ||
      !!container.querySelector('[class*="checklist"], [class*="check-list"], [class*="checklist-tree"], [class*="check-list-tree"]')
    );
  });
}

function moveParticipantsBlock(chipsFields) {
  if (!chipsFields) {
    return;
  }

  const containers = [...chipsFields.querySelectorAll(":scope > .tasks-full-card-field-container")];
  const resultContainer = containers.find((container) => {
    const text = (container.textContent || "").trim();
    return text.includes("Требуется результат");
  });

  const participantsContainer = containers.find((container) => {
    const text = (container.textContent || "").trim();
    return text.includes("Соисполнители") || text.includes("Наблюдател");
  });

  if (!resultContainer || !participantsContainer || resultContainer === participantsContainer) {
    return;
  }

  if (participantsContainer.previousElementSibling !== resultContainer) {
    chipsFields.insertBefore(participantsContainer, resultContainer.nextSibling);
  }
}

function hasDescriptionContent(description) {
  if (!description) {
    return false;
  }

  return Boolean(
    description.querySelector(
      ".tasks-card-entity-collapsible-text, .ui-typography-container, textarea, [contenteditable='true'], .tasks-card-description-editor-files.--read-only, .tasks-entity-text-area-files, .disk-user-field-control.--has-files.--embedded",
    ),
  );
}

function isCreateDescriptionPlaceholder(description) {
  if (!description) {
    return false;
  }

  const isCreateMode = description.dataset.btcCreateMode === "true";

  const miniButton = description.querySelector(
    ".tasks-card-change-description-mini-btn.print-ignore, .tasks-card-change-description-mini-btn",
  );

  if (!miniButton) {
    return false;
  }

  if (!isCreateMode && description.querySelector(".ui-text-editor-placeholder.--shown")) {
    return true;
  }

  const hasRealDescriptionStructure = Boolean(
    description.querySelector(
      ".tasks-card-entity-collapsible-text, .ui-typography-container, textarea, [contenteditable='true'], .tasks-card-description-editor-files.--read-only, .tasks-entity-text-area-files, .disk-user-field-control.--has-files.--embedded",
    ),
  );

  return !hasRealDescriptionStructure;
}

function getDescriptionMiniButtonHeight(description) {
  const miniButton = description?.querySelector(".tasks-card-change-description-mini-btn.print-ignore, .tasks-card-change-description-mini-btn");
  return Math.ceil(miniButton?.getBoundingClientRect().height || 0);
}

function hasDescriptionEditor(description) {
  if (!description) {
    return false;
  }

  const isCreateMode = description.dataset.btcCreateMode === "true";

  if (!isCreateMode && description.querySelector(".ui-text-editor-placeholder.--shown")) {
    return false;
  }

  const previewText = description.querySelector(".tasks-card-entity-collapsible-text");
  const previewFooter = description.querySelector(".tasks-card-entity-collapsible-footer");
  const previewVisible = [previewText, previewFooter].some((node) => {
    if (!node) {
      return false;
    }

    const styles = getComputedStyle(node);
    return styles.display !== "none" && styles.visibility !== "hidden";
  });

  if (previewVisible) {
    return false;
  }

  return Boolean(
    description.querySelector(
      ".ui-text-editor-editable, textarea, [contenteditable='true']",
    ),
  );
}

function syncDescriptionPlaceholderState(description) {
  if (!description) {
    return;
  }

  const miniButton = description.querySelector(
    ".tasks-card-change-description-mini-btn.print-ignore, .tasks-card-change-description-mini-btn",
  );
  const isPlaceholder = isCreateDescriptionPlaceholder(description);
  const isEditing = hasDescriptionEditor(description);

  description.dataset.btcCompact = isPlaceholder ? "true" : "false";
  description.dataset.btcEditing = isEditing ? "true" : "false";

  if (miniButton) {
    miniButton.dataset.btcCreatePlaceholder = isPlaceholder ? "true" : "false";
  }

  description.style.removeProperty("height");
  description.style.removeProperty("max-height");
  description.style.removeProperty("min-height");
}

function observeDescriptionPlaceholderState(description) {
  if (!description || description.dataset.btcPlaceholderObserverBound === "true") {
    return;
  }

  const sync = () => syncDescriptionPlaceholderState(description);
  new MutationObserver(sync).observe(description, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "contenteditable"],
  });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(sync).observe(description);
  }

  description.dataset.btcPlaceholderObserverBound = "true";
}

function setupDescriptionEditorFocusProxy(description) {
  if (!description || description.dataset.btcEditorFocusProxyBound === "true") {
    return;
  }

  description.addEventListener("click", (event) => {
    if (description.dataset.btcCompact === "true" || description.dataset.btcEditing !== "true") {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }

    if (
      target.closest("button, a, input, textarea, [contenteditable='true'], .ui-btn, .tasks-card-description-footer-buttons")
    ) {
      return;
    }

    const editable = description.querySelector(".ui-text-editor-editable, [contenteditable='true'], textarea");
    if (!editable) {
      return;
    }

    if (typeof editable.focus === "function") {
      editable.focus();
    }

    const selection = window.getSelection?.();
    if (selection && editable.firstChild) {
      try {
        const range = document.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      } catch {}
    }
  });

  description.dataset.btcEditorFocusProxyBound = "true";
}

function hideEmptyContentPlaceholders(content, keepNodes) {
  if (!content) return;

  [...content.children].forEach((child) => {
    if (keepNodes.includes(child)) {
      child.style.display = "";
      return;
    }

    const text = (child.textContent || "").trim();
    if (!text && child.children.length === 0) {
      child.style.display = "none";
    }
  });
}

function syncChecklistHeight(stack, checklist) {
  if (!stack || !checklist) {
    return;
  }

  if (checklist.dataset.btcCollapsed === "true") {
    return;
  }

  const minChecklistHeight = 140;
  const minDescriptionHeight = 180;
  const maxChecklistHeight = getChecklistMaxHeight(stack, checklist, minChecklistHeight, minDescriptionHeight);

  const preferredHeight = parseFloat(checklist.dataset.expandedHeight || "") || getStoredChecklistHeight();
  const nextHeight = Math.min(maxChecklistHeight, Math.max(minChecklistHeight, preferredHeight));
  const rounded = Math.round(nextHeight);

  stack.style.setProperty("--btc-checklist-height", `${rounded}px`);
  checklist.style.flexBasis = `${rounded}px`;
  checklist.style.height = `${rounded}px`;
}

function primeChecklistExpandedHeightFromLiveLayout(stack, checklist, options = {}) {
  if (!stack || !checklist || checklist.dataset.btcCollapsed === "true") {
    return 0;
  }

  const { persist = false, force = false } = options;
  const alreadyPrimed = checklist.dataset.btcExpandedHeightPrimed === "true";
  if (alreadyPrimed && !force) {
    return parseFloat(checklist.dataset.expandedHeight || "") || 0;
  }

  const liveHeight = Math.round(checklist.getBoundingClientRect().height)
    || Math.round(getChecklistNaturalHeight(stack, checklist))
    || getStoredChecklistHeight();

  checklist.dataset.expandedHeight = `${liveHeight}px`;
  checklist.dataset.btcExpandedHeightPrimed = "true";
  stack.style.setProperty("--btc-checklist-height", `${liveHeight}px`);
  checklist.style.flexBasis = `${liveHeight}px`;
  checklist.style.height = `${liveHeight}px`;

  if (persist) {
    setStoredChecklistHeight(liveHeight);
  }

  return liveHeight;
}

function stabilizeChecklistHeightAfterInit(stack, checklist) {
  if (!stack || !checklist || checklist.dataset.btcCollapsed === "true") {
    return;
  }

  if (checklist.dataset.btcHeightStabilizerBound === RESIZER_BIND_VERSION) {
    return;
  }

  checklist.dataset.btcHeightStabilizerBound = RESIZER_BIND_VERSION;

  const sync = () => {
    if (!document.contains(checklist) || checklist.dataset.btcCollapsed === "true") {
      return;
    }

    primeChecklistExpandedHeightFromLiveLayout(stack, checklist, { force: true });
    syncChecklistHeight(stack, checklist);
  };

  sync();
  window.requestAnimationFrame(sync);
  window.setTimeout(sync, 120);
  window.setTimeout(sync, 360);
}

function getResizerReservedHeight(stack) {
  const resizer = stack?.querySelector(".btc-checklist-resizer");
  if (!resizer) {
    return 0;
  }

  const rect = resizer.getBoundingClientRect();
  const styles = getComputedStyle(resizer);
  const marginTop = parseFloat(styles.marginTop) || 0;
  const marginBottom = parseFloat(styles.marginBottom) || 0;
  return Math.ceil(rect.height + marginTop + marginBottom);
}

function getChecklistNaturalHeight(stack, checklist) {
  if (!stack || !checklist) {
    return 0;
  }

  const prevVar = stack.style.getPropertyValue("--btc-checklist-height");
  const prevHeight = checklist.style.height;
  const prevFlexBasis = checklist.style.flexBasis;

  stack.style.setProperty("--btc-checklist-height", "auto");
  checklist.style.height = "auto";
  checklist.style.flexBasis = "auto";

  const headerHeight = getChecklistPanelHeight(checklist);
  const body = checklist.querySelector(":scope > .btc-checklist-body");
  const root = checklist.querySelector(".tasks-check-list-list");
  const content = checklist.querySelector(".tasks-check-list-list-content");
  const parentList = checklist.querySelector(".check-list-widget.--parent, .check-list-widget");
  const bodyHeight = Math.ceil(Math.max(
    body?.getBoundingClientRect().height || 0,
    body?.scrollHeight || 0,
    root?.scrollHeight || 0,
    content?.scrollHeight || 0,
    parentList?.scrollHeight || 0,
  ));

  const naturalHeight = Math.ceil(Math.max(
    checklist.getBoundingClientRect().height,
    checklist.scrollHeight,
    headerHeight + bodyHeight,
  ));

  if (prevVar) {
    stack.style.setProperty("--btc-checklist-height", prevVar);
  } else {
    stack.style.removeProperty("--btc-checklist-height");
  }

  if (prevHeight) {
    checklist.style.height = prevHeight;
  } else {
    checklist.style.removeProperty("height");
  }

  if (prevFlexBasis) {
    checklist.style.flexBasis = prevFlexBasis;
  } else {
    checklist.style.removeProperty("flex-basis");
  }

  return naturalHeight;
}

function getChecklistMaxHeight(stack, checklist, minChecklistHeight, minDescriptionHeight) {
  const stackRect = stack.getBoundingClientRect();
  const reservedHeight = getResizerReservedHeight(stack);
  const layoutMaxHeight = Math.max(
    minChecklistHeight,
    Math.floor(stackRect.height - minDescriptionHeight - reservedHeight),
  );
  const naturalHeight = getChecklistNaturalHeight(stack, checklist);

  if (!naturalHeight) {
    return layoutMaxHeight;
  }

  return Math.max(minChecklistHeight, Math.min(layoutMaxHeight, naturalHeight));
}

function isChecklistPanelCollapsed(checklist) {
  return checklist?.dataset.btcCollapsed === "true";
}

function getChecklistPanelHeight(checklist) {
  const header = checklist?.querySelector(":scope > .btc-checklist-header");
  return Math.max(44, Math.ceil(header?.getBoundingClientRect().height || 0));
}

function ensureChecklistPanelStructure(checklist) {
  if (!checklist) {
    return null;
  }

  let header = checklist.querySelector(":scope > .btc-checklist-header");
  if (!header) {
    header = document.createElement("button");
    header.type = "button";
    header.className = "btc-checklist-header";
    header.innerHTML = '<span class="btc-checklist-header__title">Чек-листы</span><span class="btc-checklist-header__chevron" aria-hidden="true"></span>';
    checklist.prepend(header);
  }

  let body = checklist.querySelector(":scope > .btc-checklist-body");
  if (!body) {
    body = document.createElement("div");
    body.className = "btc-checklist-body";
    checklist.appendChild(body);
  }

  [...checklist.children].forEach((child) => {
    if (child === header || child === body) {
      return;
    }

    body.appendChild(child);
  });

  return { header, body };
}

function applyChecklistPanelState(stack, checklist) {
  if (!stack || !checklist) {
    return;
  }

  const structure = ensureChecklistPanelStructure(checklist);
  if (!structure) {
    return;
  }

  const { header, body } = structure;
  const isCollapsed = isChecklistPanelCollapsed(checklist);

  checklist.dataset.collapsed = isCollapsed ? "true" : "false";
  header.dataset.collapsed = isCollapsed ? "true" : "false";
  header.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
  body.hidden = false;
  body.style.display = "flex";
  body.style.visibility = isCollapsed ? "hidden" : "visible";
  body.style.pointerEvents = isCollapsed ? "none" : "auto";
  body.style.flex = isCollapsed ? "0 0 auto" : "1 1 auto";
  body.style.height = isCollapsed ? "0" : "auto";
  body.style.minHeight = "0";
  body.style.overflow = "hidden";

  applyChecklistLayoutStyles(stack, checklist);

  if (isCollapsed) {
    const collapsedHeight = getChecklistPanelHeight(checklist);
    stack.style.setProperty("--btc-checklist-height", `${collapsedHeight}px`);
    checklist.style.flexBasis = `${collapsedHeight}px`;
    checklist.style.height = `${collapsedHeight}px`;
    return;
  }

  const storedHeight = parseFloat(checklist.dataset.expandedHeight || "") || getStoredChecklistHeight();
  stack.style.setProperty("--btc-checklist-height", `${storedHeight}px`);
  checklist.style.flexBasis = `${storedHeight}px`;
  checklist.style.height = `${storedHeight}px`;
  syncChecklistHeight(stack, checklist);

  window.requestAnimationFrame(() => {
    if (!document.contains(checklist) || isChecklistPanelCollapsed(checklist)) {
      return;
    }

    syncChecklistHeight(stack, checklist);
  });
}

function setChecklistPanelCollapsed(stack, checklist, collapsed) {
  if (!stack || !checklist) {
    return;
  }

  const currentState = isChecklistPanelCollapsed(checklist);
  if (currentState === collapsed) {
    applyChecklistPanelState(stack, checklist);
    return;
  }

  if (collapsed) {
    const currentHeight = parseFloat(checklist.style.height)
      || Math.ceil(checklist.getBoundingClientRect().height)
      || getStoredChecklistHeight();
    checklist.dataset.expandedHeight = `${currentHeight}px`;
  }

  checklist.dataset.btcCollapsed = collapsed ? "true" : "false";
  setStoredChecklistCollapsed(collapsed);
  applyChecklistPanelState(stack, checklist);
}

function setupChecklistPanelToggle(stack, checklist) {
  if (!stack || !checklist) {
    return;
  }

  const structure = ensureChecklistPanelStructure(checklist);
  if (!structure) {
    return;
  }

  const { header } = structure;
  if (header.dataset.bound === CHECKLIST_TOGGLE_BIND_VERSION) {
    return;
  }

  header.addEventListener("click", () => {
    setChecklistPanelCollapsed(stack, checklist, !isChecklistPanelCollapsed(checklist));
  });

  header.dataset.bound = CHECKLIST_TOGGLE_BIND_VERSION;
}

function getCollapsedChecklistPreviewHeight(checklist) {
  if (!checklist) {
    return 0;
  }

  const previewNodes = [
    ".check-list-widget-parent-item-label-container",
    ".check-list-widget-item-icon",
    ".check-list-widget-parent-item-title-container",
    ".check-list-widget-parent-item-title",
    ".check-list-widget-parent-item-title-status",
    ".check-list-widget-parent-item-action",
    ".check-list-widget-parent-item-main-action",
    ".tasks-check-list-footer.--preview",
    ".tasks-check-list-footer.print-ignore.--preview",
  ].flatMap((selector) => [...checklist.querySelectorAll(selector)]);

  let top = Infinity;
  let bottom = -Infinity;

  previewNodes.forEach((node) => {
    const rect = node.getBoundingClientRect();
    if (rect.height <= 0 || rect.width <= 0) {
      return;
    }

    top = Math.min(top, rect.top);
    bottom = Math.max(bottom, rect.bottom);
  });

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) {
    return 0;
  }

  return Math.ceil(bottom - top);
}

function getCollapsedChecklistHeight(checklist, options = {}) {
  if (!checklist) {
    return 72;
  }

  const { includeRootScroll = true } = options;

  const root = checklist.querySelector(".tasks-check-list-list");
  const wrapper = checklist.querySelector(".tasks-check-list-wrapper");
  const container = checklist.querySelector(".check-list-widget-container");
  const parentList = checklist.querySelector(".check-list-widget.--parent, .check-list-widget");
  const parentItem = checklist.querySelector(".check-list-widget-item.--parent, .check-list-widget-parent-item");
  const collapsedMarker = checklist.querySelector(
    ".check-list-widget-item.--parent.--collapsed, .check-list-widget-parent-item.--collapsed",
  );
  const parentItemStyles = parentItem ? getComputedStyle(parentItem) : null;
  const marginBottom = Math.max(0, parseFloat(parentItemStyles?.marginBottom || "0") || 0);
  const rootScrollHeight = Math.ceil(root?.scrollHeight || 0);
  const parentItemHeight = parentItem ? Math.ceil(parentItem.getBoundingClientRect().height) : 0;
  const parentItemScrollHeight = Math.ceil(parentItem?.scrollHeight || 0);
  const wrapperHeight = Math.ceil(wrapper?.getBoundingClientRect().height || 0);
  const wrapperScrollHeight = Math.ceil(wrapper?.scrollHeight || 0);
  const containerHeight = Math.ceil(container?.getBoundingClientRect().height || 0);
  const containerScrollHeight = Math.ceil(container?.scrollHeight || 0);
  const parentListHeight = Math.ceil(parentList?.getBoundingClientRect().height || 0);
  const parentListScrollHeight = Math.ceil(parentList?.scrollHeight || 0);
  const previewHeight = getCollapsedChecklistPreviewHeight(checklist);

  if (collapsedMarker && previewHeight > 0) {
    let measured = previewHeight;

    if (includeRootScroll && rootScrollHeight > 0 && rootScrollHeight <= previewHeight + 48) {
      measured = Math.max(measured, rootScrollHeight);
    }

    return Math.max(72, Math.ceil(measured + 4));
  }

  const measured = Math.max(
    includeRootScroll ? rootScrollHeight : 0,
    parentItemHeight + marginBottom,
    parentItemScrollHeight + marginBottom,
    wrapperHeight,
    wrapperScrollHeight,
    containerHeight,
    containerScrollHeight,
    parentListHeight,
    parentListScrollHeight,
  );

  return Math.max(72, Math.ceil(measured + 4));
}

function applyCollapsedChecklistHeight(stack, checklist, options = {}) {
  if (!stack || !checklist) {
    return;
  }

  const collapsedHeight = getCollapsedChecklistHeight(checklist, options);
  stack.style.setProperty("--btc-checklist-height", `${collapsedHeight}px`);
  checklist.style.flexBasis = `${collapsedHeight}px`;
  checklist.style.height = `${collapsedHeight}px`;
}

function hasCollapsedChecklistMarker(checklist) {
  if (!checklist) {
    return false;
  }

  return Boolean(checklist.querySelector(
    ".check-list-widget-item.--parent.--collapsed, .check-list-widget-parent-item.--collapsed",
  ));
}

function scheduleCollapsedHeightRefinement(stack, checklist, attempt = 0) {
  if (!stack || !checklist || checklist.dataset.collapsed !== "true") {
    return;
  }

  const parentItem = checklist.querySelector(
    ".check-list-widget-item.--parent.--collapsed, .check-list-widget-parent-item.--collapsed",
  );

  if (parentItem) {
    applyChecklistLayoutStyles(stack, checklist);
    applyCollapsedChecklistHeight(stack, checklist, { includeRootScroll: true });
    return;
  }

  if (attempt >= 8) {
    return;
  }

  window.setTimeout(() => {
    if (!document.contains(checklist) || checklist.dataset.collapsed !== "true") {
      return;
    }

    scheduleCollapsedHeightRefinement(stack, checklist, attempt + 1);
  }, 80);
}

function applyChecklistLayoutStyles(stack, checklist) {
  if (!stack || !checklist) {
    return;
  }

  const isCollapsed = isChecklistPanelCollapsed(checklist);

  checklist.style.display = "flex";
  checklist.style.flexDirection = "column";
  checklist.style.width = "100%";
  checklist.style.minWidth = "0";
  checklist.style.alignSelf = "stretch";
  checklist.style.margin = "0";
  checklist.style.overflow = "hidden";
  checklist.style.overflowX = "hidden";
  checklist.style.background = "#fff";
  checklist.style.borderRadius = "14px";
  checklist.style.minHeight = isCollapsed ? "0" : "140px";

  const root = checklist.querySelector(".tasks-check-list-list");
  if (root) {
    root.style.display = "block";
    root.style.flex = isCollapsed ? "0 0 auto" : "1 1 0";
    root.style.height = isCollapsed ? "" : "100%";
    root.style.minHeight = "0";
    root.style.overflowY = isCollapsed ? "visible" : "auto";
    root.style.overflowX = "hidden";
    root.style.scrollbarGutter = "stable";
  }

  const resizer = stack.querySelector(".btc-checklist-resizer");
  if (resizer) {
    resizer.dataset.locked = isCollapsed ? "true" : "false";
    resizer.style.pointerEvents = isCollapsed ? "none" : "auto";
    resizer.style.cursor = isCollapsed ? "default" : "row-resize";
  }
}

function updateChecklistCollapsedState(stack, checklist) {
  if (!stack || !checklist) {
    return;
  }

  if (checklist.dataset.stateUpdateInProgress === "true") {
    return;
  }

  checklist.dataset.stateUpdateInProgress = "true";

  try {
    const root = checklist.querySelector(".tasks-check-list-list");
    const parentList = checklist.querySelector(".check-list-widget.--parent, .check-list-widget");
    const parentItem = checklist.querySelector(".check-list-widget-item.--parent, .check-list-widget-parent-item");
    const collapsedMarker = checklist.querySelector(
      ".check-list-widget-item.--parent.--collapsed, .check-list-widget-parent-item.--collapsed",
    );
    if (!root || !parentList) {
      return;
    }

    const wasCollapsed = checklist.dataset.collapsed === "true";
    const currentHeight = Math.ceil(checklist.getBoundingClientRect().height);
    const compactHeight = getCollapsedChecklistHeight(checklist, { includeRootScroll: false });
    const parentHeight = Math.ceil(Math.max(
      parentItem?.getBoundingClientRect().height || 0,
      parentList.getBoundingClientRect().height,
    ));
    const isTransitioningToCollapsed = !wasCollapsed
      && currentHeight > compactHeight + 24
      && parentHeight > 0
      && parentHeight <= compactHeight + 16;
    const isCollapsed = Boolean(collapsedMarker) || isTransitioningToCollapsed;

    if (isCollapsed) {
      checklist.dataset.collapsed = "true";
      applyChecklistLayoutStyles(stack, checklist);

      if (!wasCollapsed) {
        captureChecklistTransition("transition-before-collapse-height");
        const expandedHeight = parseFloat(checklist.style.height) || currentHeight || getStoredChecklistHeight();
        checklist.dataset.expandedHeight = `${expandedHeight}px`;
        applyCollapsedChecklistHeight(stack, checklist, { includeRootScroll: false });
        captureChecklistTransition("transition-after-collapse-height");
        scheduleCollapsedHeightRefinement(stack, checklist);
      }

      return;
    }

    checklist.dataset.collapsed = "false";

    if (!wasCollapsed) {
      applyChecklistLayoutStyles(stack, checklist);
      return;
    }

    captureChecklistTransition("transition-before-expand-restore");
    const storedHeight = checklist.dataset.expandedHeight || `${getStoredChecklistHeight()}px`;
    const numericHeight = parseFloat(storedHeight) || getStoredChecklistHeight();
    stack.style.setProperty("--btc-checklist-height", `${numericHeight}px`);
    checklist.style.flexBasis = `${numericHeight}px`;
    checklist.style.height = `${numericHeight}px`;
    applyChecklistLayoutStyles(stack, checklist);
    checklist.dataset.expandedHeight = `${numericHeight}px`;
    captureChecklistTransition("transition-after-expand-restore");
  } finally {
    checklist.dataset.stateUpdateInProgress = "false";
  }
}

function observeChecklistState(stack, checklist) {
  if (!stack || !checklist || checklist.dataset.stateObserverBound === "true") {
    return true;
  }

  const root = checklist.querySelector(".tasks-check-list-list");
  const parentList = checklist.querySelector(".check-list-widget.--parent, .check-list-widget");
  if (!root || !parentList) {
    return false;
  }

  const update = () => updateChecklistCollapsedState(stack, checklist);

  new MutationObserver(update).observe(root, { childList: true, subtree: true });
  new MutationObserver(update).observe(parentList, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(update).observe(root);
    new ResizeObserver(update).observe(parentList);
  }

  update();
  checklist.dataset.stateObserverBound = "true";
  return true;
}

function ensureChecklistReady(stack, checklist, attempt = 0) {
  if (!stack || !checklist) {
    return;
  }

  const isReady = observeChecklistState(stack, checklist);
  if (isReady || attempt >= CHECKLIST_INIT_MAX_RETRIES) {
    return;
  }

  window.setTimeout(() => {
    if (!document.contains(checklist)) {
      return;
    }

    ensureChecklistReady(stack, checklist, attempt + 1);
  }, CHECKLIST_INIT_RETRY_DELAY);
}

function observeChecklistContainer(card) {
  if (!card || card.dataset.btcChecklistContainerObserverBound === "true") {
    return;
  }

  const chipsFields = card.querySelector(SELECTORS.chipsFields);
  if (!chipsFields) {
    return;
  }

  card.dataset.btcChecklistContainerObserverBound = "true";

  const syncChecklistLayout = () => {
    const checklistInChips = findChecklistContainer(chipsFields);
    const bottom = card.querySelector(".btc-main-bottom");
    const checklistInBottom = bottom?.querySelector(".btc-checklist-block, :scope > .tasks-full-card-field-container");

    if (!checklistInChips || checklistInBottom === checklistInChips) {
      return;
    }

    applyLayout(card);
  };

  new MutationObserver(syncChecklistLayout).observe(chipsFields, { childList: true, subtree: true });
  syncChecklistLayout();
}

function setupChecklistResizer(stack, resizer, checklist) {
  if (!stack || !resizer || !checklist || resizer.dataset.bound === RESIZER_BIND_VERSION) {
    return;
  }

  const minDescriptionHeight = 180;

  const startResize = (getClientY, moveEventName, endEventName, event) => {
    event.preventDefault();
    event.stopPropagation();

    if (isChecklistPanelCollapsed(checklist)) {
      return;
    }

    const minChecklistHeight = 140;
    primeChecklistExpandedHeightFromLiveLayout(stack, checklist, { force: true });
    syncChecklistHeight(stack, checklist);

    if (typeof resizer.setPointerCapture === "function" && typeof event.pointerId === "number") {
      try {
        resizer.setPointerCapture(event.pointerId);
      } catch {}
    }

    const stackRect = stack.getBoundingClientRect();
    const startY = getClientY(event);
    const startHeight = checklist.getBoundingClientRect().height;

    const applyHeight = (nextChecklistHeight) => {
      const rounded = Math.round(nextChecklistHeight);
      stack.style.setProperty("--btc-checklist-height", `${rounded}px`);
      checklist.style.flexBasis = `${rounded}px`;
      checklist.style.height = `${rounded}px`;
      checklist.dataset.expandedHeight = `${rounded}px`;
      setStoredChecklistHeight(rounded);
    };

    const onMove = (moveEvent) => {
      const deltaY = getClientY(moveEvent) - startY;
      const minChecklistHeight = 140;
      const layoutMaxChecklistHeight = Math.max(
        minChecklistHeight,
        Math.floor(stackRect.height - minDescriptionHeight - getResizerReservedHeight(stack)),
      );
      const contentMaxChecklistHeight = getChecklistNaturalHeight(stack, checklist);
      const maxChecklistHeight = Math.max(
        minChecklistHeight,
        Math.min(layoutMaxChecklistHeight, contentMaxChecklistHeight || layoutMaxChecklistHeight),
      );
      const nextChecklistHeight = Math.min(
        maxChecklistHeight,
        Math.max(minChecklistHeight, startHeight - deltaY),
      );

      applyHeight(nextChecklistHeight);
    };

    const onCancelSelection = (cancelEvent) => {
      cancelEvent.preventDefault();
    };

    const onUp = () => {
      window.removeEventListener(moveEventName, onMove, true);
      window.removeEventListener(endEventName, onUp, true);
      window.removeEventListener("dragstart", onCancelSelection, true);
      window.removeEventListener("selectstart", onCancelSelection, true);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      document.body.style.removeProperty("touch-action");
    };

    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.body.style.touchAction = "none";

    window.addEventListener(moveEventName, onMove, { passive: false, capture: true });
    window.addEventListener(endEventName, onUp, { capture: true });
    window.addEventListener("dragstart", onCancelSelection, { capture: true });
    window.addEventListener("selectstart", onCancelSelection, { capture: true });
  };

  resizer.addEventListener("pointerdown", (event) => {
    startResize((e) => e.clientY, "pointermove", "pointerup", event);
  });

  resizer.addEventListener("mousedown", (event) => {
    startResize((e) => e.clientY, "mousemove", "mouseup", event);
  });

  resizer.addEventListener("touchstart", (event) => {
    startResize((e) => e.touches[0].clientY, "touchmove", "touchend", event);
  }, { passive: false });

  resizer.dataset.bound = RESIZER_BIND_VERSION;
}

function getChecklistTextareas(checklist) {
  return [...checklist.querySelectorAll("textarea.b24-growing-text-area-edit")];
}

function getChecklistReadonlyInlineEditorTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const previewWrapper = target.closest(".tasks-check-list-wrapper.--preview");
  if (!previewWrapper || target.closest(".tasks-check-list-wrapper.--sheet")) {
    return null;
  }

  if (target.closest(
    "input[type='checkbox'], button, a, .ui-icon-set, .check-list-widget-item-icon, .check-list-widget-parent-item-action, .check-list-widget-parent-item-main-action, .tasks-check-list-close-icon",
  )) {
    return null;
  }

  const growingTextArea = target.closest(".b24-growing-text-area.check-list-widget-child-item-title");
  const textarea = target.closest("textarea.b24-growing-text-area-edit")
    || growingTextArea?.querySelector("textarea.b24-growing-text-area-edit")
    || target.closest(".check-list-widget-item, .check-list-widget-parent-item")?.querySelector("textarea.b24-growing-text-area-edit");
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return null;
  }

  const textareaWrapper = textarea.closest(".b24-growing-text-area");
  if (!textareaWrapper?.classList.contains("--readonly")) {
    return null;
  }

  return textarea;
}

function getChecklistPreviewInlineEditorTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const previewWrapper = target.closest(".tasks-check-list-wrapper.--preview");
  if (!previewWrapper || target.closest(".tasks-check-list-wrapper.--sheet")) {
    return null;
  }

  if (target.closest(
    "input[type='checkbox'], button, a, .ui-icon-set, .check-list-widget-item-icon, .check-list-widget-parent-item-action, .check-list-widget-parent-item-main-action, .tasks-check-list-close-icon, .check-list-widget-add-item, .check-list-widget-add-item-title",
  )) {
    return null;
  }

  const growingTextArea = target.closest(".b24-growing-text-area.check-list-widget-child-item-title");
  const textarea = target.closest("textarea.b24-growing-text-area-edit")
    || growingTextArea?.querySelector("textarea.b24-growing-text-area-edit")
    || target.closest(".check-list-widget-item, .check-list-widget-parent-item")?.querySelector("textarea.b24-growing-text-area-edit");

  return textarea instanceof HTMLTextAreaElement ? textarea : null;
}

function getChecklistAddItemPreviewTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }

  const previewWrapper = target.closest(".tasks-check-list-wrapper.--preview");
  if (!previewWrapper || target.closest(".tasks-check-list-wrapper.--sheet")) {
    return null;
  }

  if (target.closest(
    "input[type='checkbox'], .check-list-widget-item-icon, .tasks-check-list-close-icon",
  )) {
    return null;
  }

  const item = target.closest("li.check-list-widget-item.check-list-draggable-item");
  if (!item) {
    return null;
  }

  const itemText = (item.textContent || "").trim();
  if (!itemText.startsWith("Добавить пункт")) {
    return null;
  }

  return item;
}

function findChecklistInlineAddTrigger(addItem) {
  if (!(addItem instanceof Element)) {
    return null;
  }

  const titleTrigger = addItem.querySelector(".check-list-widget-add-item-title");
  if (titleTrigger instanceof HTMLElement) {
    return titleTrigger;
  }

  const directTrigger = addItem.querySelector(".check-list-widget-add-item.print-ignore, .check-list-widget-add-item");
  if (directTrigger instanceof HTMLElement) {
    return directTrigger;
  }

  const candidates = [
    ...addItem.querySelectorAll("button, a, [role='button'], .ui-btn, [tabindex]"),
  ].filter((node) => node instanceof HTMLElement);

  const labeled = candidates.find((node) => ((node.textContent || "").trim().includes("Добавить пункт")));
  if (labeled instanceof HTMLElement) {
    return labeled;
  }

  return candidates[0] || null;
}

function focusChecklistInlineEditor(textarea, options = {}) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return false;
  }

  const { moveCaretToEnd = false } = options;
  const growingTextArea = textarea.closest(".b24-growing-text-area");

  textarea.readOnly = false;
  textarea.removeAttribute("readonly");
  growingTextArea?.classList.remove("--readonly");

  try {
    textarea.focus({ preventScroll: true });
  } catch {
    textarea.focus();
  }

  if (moveCaretToEnd) {
    const valueLength = textarea.value.length;
    try {
      textarea.setSelectionRange(valueLength, valueLength);
    } catch {}
  }

  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  return document.activeElement === textarea;
}

function unlockChecklistInlineEditor(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return false;
  }

  const growingTextArea = textarea.closest(".b24-growing-text-area");
  textarea.readOnly = false;
  textarea.removeAttribute("readonly");
  growingTextArea?.classList.remove("--readonly");
  return true;
}

function focusNewestChecklistTextarea(checklist, previousTextareas = []) {
  if (!checklist) {
    return false;
  }

  const previousSet = new Set(previousTextareas);
  const currentTextareas = getChecklistTextareas(checklist);
  const newest = currentTextareas.find((textarea) => !previousSet.has(textarea))
    || currentTextareas.find((textarea) => !textarea.value.trim())
    || currentTextareas[currentTextareas.length - 1]
    || null;

  return focusChecklistInlineEditor(newest, { moveCaretToEnd: true });
}

function focusNewChecklistTextareaOnly(checklist, previousTextareas = []) {
  if (!checklist) {
    return false;
  }

  const previousSet = new Set(previousTextareas);
  const currentTextareas = getChecklistTextareas(checklist);
  const newest = currentTextareas.find((textarea) => !previousSet.has(textarea)) || null;
  return focusChecklistInlineEditor(newest, { moveCaretToEnd: true });
}

function getLastChecklistItemTextarea(checklist) {
  if (!checklist) {
    return null;
  }

  const textareas = [...checklist.querySelectorAll(
    ".check-list-widget-child-item-title textarea.b24-growing-text-area-edit",
  )];
  return textareas[textareas.length - 1] || null;
}

function dispatchChecklistEnter(textarea) {
  if (!(textarea instanceof HTMLTextAreaElement)) {
    return false;
  }

  const eventInit = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };

  const keydown = new KeyboardEvent("keydown", eventInit);
  const keypress = new KeyboardEvent("keypress", eventInit);
  const keyup = new KeyboardEvent("keyup", eventInit);

  const keydownAccepted = textarea.dispatchEvent(keydown);
  textarea.dispatchEvent(keypress);
  textarea.dispatchEvent(keyup);
  return keydownAccepted;
}

function setupChecklistEnterFocusFlow(checklist) {
  if (!checklist || checklist.dataset.btcInlineEnterBound === "true") {
    return;
  }

  checklist.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const textarea = event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!textarea || !checklist.contains(textarea)) {
      return;
    }

    const previousTextareas = getChecklistTextareas(checklist);
    const focusAttempts = [0, 60, 140, 260, 420, 700];
    focusAttempts.forEach((delay) => {
      window.setTimeout(() => {
        if (!document.contains(checklist) || checklist.closest(".tasks-check-list-wrapper.--sheet")) {
          return;
        }

        focusNewestChecklistTextarea(checklist, previousTextareas);
      }, delay);
    });
  }, true);

  checklist.dataset.btcInlineEnterBound = "true";
}

function setupChecklistReadonlyInlineActivation(checklist) {
  if (!checklist || checklist.dataset.btcReadonlyInlineBound === "true") {
    return;
  }
  checklist.dataset.btcReadonlyInlineBound = "true";
}

function setupGlobalChecklistPreviewInterception() {
  if (window.__btcChecklistPreviewInterceptionBound === true) {
    return;
  }

  const handleReadonlyPreviewEvent = (event) => {
    if (event.type !== "click") {
      return;
    }

    const textarea = getChecklistPreviewInlineEditorTarget(event.target);
    if (!textarea) {
      return;
    }

    event.stopPropagation();
    event.stopImmediatePropagation();

    const isReadonly = textarea.readOnly || textarea.hasAttribute("readonly")
      || textarea.closest(".b24-growing-text-area")?.classList.contains("--readonly");

    if (!isReadonly) {
      return;
    }

    event.preventDefault();

    window.requestAnimationFrame(() => {
      focusChecklistInlineEditor(textarea);
    });
  };

  window.addEventListener("click", handleReadonlyPreviewEvent, true);
  window.__btcChecklistPreviewInterceptionBound = true;
}

function setupChecklistAddItemInlineActivation(checklist) {
  if (!checklist || checklist.dataset.btcAddItemInlineBound === "true") {
    return;
  }

  let pendingAddItemRequest = null;

  const handleAddItemPointerStart = (event) => {
    const addItem = getChecklistAddItemPreviewTarget(event.target);
    if (!addItem) {
      return;
    }

    const sourceTextarea = getLastChecklistItemTextarea(checklist);
    if (!(sourceTextarea instanceof HTMLTextAreaElement)) {
      return;
    }

    pendingAddItemRequest = {
      previousTextareas: getChecklistTextareas(checklist),
      sourceTextarea,
    };

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  checklist.addEventListener("click", (event) => {
    const addItem = getChecklistAddItemPreviewTarget(event.target);
    if (!addItem) {
      return;
    }

    const request = pendingAddItemRequest;
    pendingAddItemRequest = null;
    if (!request?.sourceTextarea || !document.contains(request.sourceTextarea)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    focusChecklistInlineEditor(request.sourceTextarea, { moveCaretToEnd: true });
    dispatchChecklistEnter(request.sourceTextarea);

    const focusAttempts = [0, 60, 140, 260, 420, 700];
    focusAttempts.forEach((delay) => {
      window.setTimeout(() => {
        if (!document.contains(checklist) || checklist.closest(".tasks-check-list-wrapper.--sheet")) {
          return;
        }

        focusNewChecklistTextareaOnly(checklist, request.previousTextareas);
      }, delay);
    });
  }, true);

  checklist.addEventListener("pointerdown", handleAddItemPointerStart, true);
  checklist.addEventListener("mousedown", handleAddItemPointerStart, true);

  checklist.dataset.btcAddItemInlineBound = "true";
}

function setupMainColumnLayout(card) {
  const content = card.querySelector(SELECTORS.content);
  const description = card.querySelector(SELECTORS.description);
  const fields = card.querySelector(SELECTORS.fields);
  const chipsFields = card.querySelector(SELECTORS.chipsFields);
  const footerCreate = card.querySelector(SELECTORS.footerCreate);
  const isCreateMode = Boolean(footerCreate) || window.location.href.includes("/tasks/task/edit/0/");

  if (!content || !fields) {
    return;
  }

  const stack = ensureMainStack(content, fields);
  if (!stack) {
    return;
  }

  stack.dataset.btcDescriptionCompact = "false";

  const bottom = ensureMainBottom(stack);
  if (!bottom) {
    return;
  }

  if (!description) {
    ensureDescriptionMissingPlaceholder(stack);

    const existingChecklistInBottom = bottom.querySelector(
      ".btc-checklist-block, :scope > .tasks-full-card-field-container",
    );
    const checklistContainer = findChecklistContainer(chipsFields) || existingChecklistInBottom;
    let resizer = stack.querySelector(".btc-checklist-resizer");

    if (checklistContainer) {
      checklistContainer.classList.add("btc-checklist-block");
      checklistContainer.style.marginBottom = "0";
      applyChecklistLayoutStyles(stack, checklistContainer);

      if (!resizer) {
        resizer = document.createElement("div");
        resizer.className = "btc-checklist-resizer";
      }

      if (resizer.parentElement !== bottom) {
        bottom.appendChild(resizer);
      }

      if (checklistContainer.parentElement !== bottom) {
        bottom.appendChild(checklistContainer);
      }

      if (checklistContainer.previousElementSibling !== resizer) {
        bottom.insertBefore(resizer, checklistContainer);
      }

      if (!checklistContainer.dataset.btcCollapsed) {
        checklistContainer.dataset.btcCollapsed = isStoredChecklistCollapsed() ? "true" : "false";
      }

      if (!checklistContainer.dataset.expandedHeight) {
        checklistContainer.dataset.expandedHeight = `${getStoredChecklistHeight()}px`;
      }

      setupChecklistPanelToggle(stack, checklistContainer);
      applyChecklistPanelState(stack, checklistContainer);
      stabilizeChecklistHeightAfterInit(stack, checklistContainer);
      setupChecklistResizer(stack, resizer, checklistContainer);
      setupChecklistReadonlyInlineActivation(checklistContainer);
      setupChecklistAddItemInlineActivation(checklistContainer);
      setupChecklistEnterFocusFlow(checklistContainer);
    } else if (resizer && !existingChecklistInBottom) {
      resizer.remove();
    }

    hideEmptyContentPlaceholders(content, [stack, fields]);
    observeChecklistContainer(card);
    return;
  }

  cleanupDescriptionMissingPlaceholder(stack);

  description.dataset.btcCreateMode = isCreateMode ? "true" : "false";
  description.dataset.btcEditing = hasDescriptionEditor(description) ? "true" : "false";

  const miniButtonHeight = getDescriptionMiniButtonHeight(description);
  const isCompactDescription = (
    isCreateDescriptionPlaceholder(description)
    || (!hasDescriptionContent(description) && miniButtonHeight > 0)
  );
  description.dataset.btcCompact = isCompactDescription ? "true" : "false";
  syncDescriptionPlaceholderState(description);
  observeDescriptionPlaceholderState(description);
  setupDescriptionEditorFocusProxy(description);

  if (description.parentElement !== stack) {
    stack.appendChild(description);
  }

  const existingChecklistInBottom = bottom.querySelector(
    ".btc-checklist-block, :scope > .tasks-full-card-field-container",
  );
  const checklistContainer = findChecklistContainer(chipsFields) || existingChecklistInBottom;
  let resizer = stack.querySelector(".btc-checklist-resizer");

  if (checklistContainer) {
    checklistContainer.classList.add("btc-checklist-block");
    checklistContainer.style.marginBottom = "0";
    applyChecklistLayoutStyles(stack, checklistContainer);

    if (!resizer) {
      resizer = document.createElement("div");
      resizer.className = "btc-checklist-resizer";
    }

    if (resizer.parentElement !== bottom) {
      bottom.appendChild(resizer);
    }

    if (checklistContainer.parentElement !== bottom) {
      bottom.appendChild(checklistContainer);
    }

    if (checklistContainer.previousElementSibling !== resizer) {
      bottom.insertBefore(resizer, checklistContainer);
    }

    if (!checklistContainer.dataset.btcCollapsed) {
      checklistContainer.dataset.btcCollapsed = isStoredChecklistCollapsed() ? "true" : "false";
    }

    if (!checklistContainer.dataset.expandedHeight) {
      checklistContainer.dataset.expandedHeight = `${getStoredChecklistHeight()}px`;
    }

    setupChecklistPanelToggle(stack, checklistContainer);
    applyChecklistPanelState(stack, checklistContainer);
    stabilizeChecklistHeightAfterInit(stack, checklistContainer);

    setupChecklistResizer(stack, resizer, checklistContainer);
    setupChecklistReadonlyInlineActivation(checklistContainer);
    setupChecklistAddItemInlineActivation(checklistContainer);
    setupChecklistEnterFocusFlow(checklistContainer);
  } else if (resizer && !existingChecklistInBottom) {
    resizer.remove();
  }

  hideEmptyContentPlaceholders(content, [stack, fields]);
  observeChecklistContainer(card);
}

function mergePriorityFields(card) {
  const fields = card.querySelector(SELECTORS.fields);
  const mainContainer = fields?.querySelector(SELECTORS.fieldContainer);
  const mainFieldList = mainContainer?.querySelector(".b24-field-list");
  const chipsFields = card.querySelector(SELECTORS.chipsFields);

  if (!fields || !mainContainer || !mainFieldList || !chipsFields) {
    return;
  }

  const chipsContainers = [...chipsFields.querySelectorAll(":scope > .tasks-full-card-field-container")];

  const projectContainer = chipsContainers.find((container) => {
    const fieldList = container.querySelector(".b24-field-list");
    return fieldList ? hasFieldRow(fieldList, "Проект") : false;
  });

  const projectStageContainer = chipsContainers.find((container) => {
    const fieldList = container.querySelector(".b24-field-list");
    return fieldList ? hasFieldRow(fieldList, "Стадия") : false;
  });

  const completionDateContainer = chipsContainers.find((container) =>
    !!container.querySelector(".b24-field-list-title") && hasFieldRow(container, "Дата завершения"),
  );

  if (projectStageContainer) {
    projectStageContainer.style.display = "";
    showFieldListRows(projectStageContainer.querySelector(".b24-field-list"));
  }

  if (projectContainer && !hasFieldRow(mainFieldList, "Проект")) {
    const projectFieldList = projectContainer.querySelector(".b24-field-list");
    const projectRow = projectFieldList ? findFieldRow(projectFieldList, "Проект") : null;

    if (projectRow) {
      moveRowToFieldList(mainFieldList, projectRow, "start");
      hideEmptyFieldListRows(projectFieldList);
    }
  }

  if (completionDateContainer) {
    moveCompletionDateField(mainFieldList, completionDateContainer);
  }

  if (hasFieldRow(mainFieldList, "Статус")) {
    const statusRow = findFieldRow(mainFieldList, "Статус");
    moveRowToFieldList(mainFieldList, statusRow, "after", "Дата завершения");
  }

  normalizeRightColumnVisibility(card);
}

async function applyLayout(card) {
  const main = card.querySelector(SELECTORS.main);
  const content = card.querySelector(SELECTORS.content);
  const chat = card.querySelector(SELECTORS.chat);
  const header = card.querySelector(SELECTORS.header);

  if (!main || !content || !header) {
    return;
  }

  if (!card.classList.contains("btc-layout-applied")) {
    card.classList.add("btc-layout-applied");
    logMessage("Layout applied");

    if (header.parentElement) {
      header.parentElement.removeChild(header);
    }
    main.insertBefore(header, content);

    const footerEdit = card.querySelector(SELECTORS.footerEdit);
    const footerCreate = card.querySelector(SELECTORS.footerCreate);
    if (footerEdit) {
      main.appendChild(footerEdit);
    } else if (footerCreate) {
      main.appendChild(footerCreate);
    }

    const footer = card.querySelector(SELECTORS.footer);
    if (footer) {
      footer.style.display = "none";
    }
  }

  if (chat) {
    setupChatDrawer(card);
  }
  setupGlobalChecklistPreviewInterception();
  ensureSettingsHeaderButton(card);
  setupFieldContainers(card);
  setupChips(card);
  moveParticipantsBlock(card.querySelector(SELECTORS.chipsFields));
  setupMainColumnLayout(card);
  mergePriorityFields(card);

  const settings = await getBlockSettings();
  applyVisibilitySettings(card, settings);
  observeVisibilityChanges(card);
}

async function init() {
  logMessage("init()");

  if (!isBitrixTaskContext()) {
    logMessage("Not a task context, skipping");
    return;
  }

  try {
    await waitForElement(SELECTORS.card);
    logMessage("Card found");
    await applyLayoutToPendingCards();
    checkForExtensionUpdate();
  } catch {
    logMessage("Card not found within timeout");
  }
}

function observeSidePanel() {
  logMessage("observeSidePanel started");

  new MutationObserver(() => {
    if (!isBitrixTaskContext()) {
      return;
    }

    const hasPendingCard = getTaskCards().some(
      (card) => !card.classList.contains("btc-layout-applied") && card.dataset.btcLayoutApplying !== "true",
    );

    if (hasPendingCard) {
      logMessage("Card detected via MutationObserver");
      applyLayoutToPendingCards();
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function observeVisibilityChanges(card) {
  if (!card || card.dataset.btcVisibilityObserverBound === "true") {
    return;
  }

  new MutationObserver(() => {
    const settings = getBlockSettingsSync();
    applyVisibilitySettings(card, settings);
  }).observe(card, { childList: true, subtree: true });

  card.dataset.btcVisibilityObserverBound = "true";
}

if (typeof window.BX !== "undefined" && window.BX.ready) {
  window.BX.ready(() => {
    init();
    observeSidePanel();
  });
} else if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    init();
    observeSidePanel();
  });
} else {
  init();
  observeSidePanel();
}
