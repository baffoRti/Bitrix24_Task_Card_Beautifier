"use strict";

const STORAGE_KEY_UPDATE_STATE = "btc_update_state";
const STORAGE_KEY_UPDATE_DISMISSED_VERSION = "btc_update_dismissed_version";
const UPDATE_METADATA_URL = "https://raw.githubusercontent.com/baffoRti/Bitrix24_Task_Card_Beautifier/main/distribution/latest.json";
const UPDATE_CHECK_TTL_MS = 12 * 60 * 60 * 1000;

function getManifestInfo() {
  const manifest = chrome.runtime.getManifest();
  return {
    version: manifest.version,
    versionName: manifest.version_name || manifest.version,
  };
}

function parseVersionParts(version) {
  return String(version || "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersions(left, right) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;
    if (leftPart > rightPart) {
      return 1;
    }
    if (leftPart < rightPart) {
      return -1;
    }
  }

  return 0;
}

function storageGet(keys) {
  return chrome.storage.local.get(keys);
}

function storageSet(value) {
  return chrome.storage.local.set(value);
}

function normalizeUpdateInfo(payload) {
  const manifestInfo = getManifestInfo();
  const version = String(payload?.version || "").trim();
  if (!version) {
    return null;
  }

  const versionName = String(payload?.version_name || version).trim() || version;

  return {
    version,
    versionName,
    releaseTag: String(payload?.release_tag || "").trim(),
    releaseUrl: String(payload?.release_url || "").trim(),
    downloadUrl: String(payload?.download_url || "").trim(),
    patchNotesUrl: String(payload?.patch_notes_url || "").trim(),
    publishedAt: String(payload?.published_at || "").trim(),
    currentVersion: manifestInfo.version,
    currentVersionName: manifestInfo.versionName,
    hasUpdate: compareVersions(version, manifestInfo.version) > 0,
    checkedAt: Date.now(),
  };
}

async function fetchLatestUpdateInfo() {
  const response = await fetch(UPDATE_METADATA_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Update metadata request failed with ${response.status}`);
  }

  const updateInfo = normalizeUpdateInfo(await response.json());
  if (!updateInfo) {
    throw new Error("Update metadata is invalid");
  }

  return updateInfo;
}

async function checkForUpdates(options = {}) {
  const force = options.force === true;
  const stored = await storageGet([STORAGE_KEY_UPDATE_STATE]);
  const cachedState = stored[STORAGE_KEY_UPDATE_STATE] || null;
  const cacheIsFresh = cachedState && Date.now() - Number(cachedState.checkedAt || 0) < UPDATE_CHECK_TTL_MS;

  if (!force && cacheIsFresh) {
    return cachedState;
  }

  try {
    const updateInfo = await fetchLatestUpdateInfo();
    await storageSet({ [STORAGE_KEY_UPDATE_STATE]: updateInfo });
    return updateInfo;
  } catch (error) {
    console.warn("Bitrix24 Task Card Beautifier update check failed", error);
    if (cachedState) {
      return cachedState;
    }

    const manifestInfo = getManifestInfo();
    const fallbackState = {
      hasUpdate: false,
      version: manifestInfo.version,
      versionName: manifestInfo.versionName,
      releaseUrl: "",
      checkedAt: Date.now(),
      error: true,
    };

    await storageSet({ [STORAGE_KEY_UPDATE_STATE]: fallbackState });
    return fallbackState;
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("Bitrix24 Task Card Enhancer installed");
  } else if (details.reason === "update") {
    console.log("Bitrix24 Task Card Enhancer updated");
  }

  checkForUpdates({ force: true });
});

chrome.runtime.onStartup.addListener(() => {
  checkForUpdates({ force: true });
});

chrome.action.onClicked.addListener(() => {
  // Browser action is intentionally inert. Settings open from the task card header gear.
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "btc-check-updates") {
    return false;
  }

  checkForUpdates({ force: message.force === true })
    .then((updateInfo) => sendResponse({ ok: true, updateInfo }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));

  return true;
});

checkForUpdates();
