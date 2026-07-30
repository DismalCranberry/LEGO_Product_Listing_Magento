/* service_worker.js — background run controller.
 * The scrape/download queue lives here so closing popup.html does not stop it.
 */

const STATE_KEY = "dormant_run_state_v147";
const RUN_MODES = Object.freeze({
    DATA_AND_IMAGES: "data-and-images", DATA_ONLY: "data-only", IMAGES_ONLY: "images-only"
});
const VALID_RUN_MODES = new Set(Object.values(RUN_MODES));

function normalizeRunMode(mode) {
    return VALID_RUN_MODES.has(mode) ? mode : RUN_MODES.DATA_AND_IMAGES;
}

function runModeLabel(mode) {
    switch (normalizeRunMode(mode)) {
        case RUN_MODES.DATA_ONLY:
            return "Data only";
        case RUN_MODES.IMAGES_ONLY:
            return "Images only";
        default:
            return "Data + images";
    }
}

const MAX_LOG_LINES = 250;

const DEFAULT_STATE = {
    running: false,
    status: "idle",
    activeTabId: null,
    currentId: "",
    total: 0,
    completed: 0,
    remaining: 0,
    results: [],
    logs: [],
    startedAt: null,
    finishedAt: null,
    lastError: "",
    mode: RUN_MODES.DATA_AND_IMAGES
};

let state = cloneDefaultState();
let initialized = false;
let initializationPromise = null;
let runAbortController = null;
let runGeneration = 0;
let persistTimer = null;

function cloneDefaultState() {
    return {
        ...DEFAULT_STATE, results: [], logs: []
    };
}

function makeAbortError() {
    const error = new Error("Operation cancelled");
    error.name = "AbortError";
    return error;
}

function isAbortError(error) {
    return error?.name === "AbortError";
}

function sleep(ms, signal = null) {
    if (signal?.aborted) return Promise.reject(makeAbortError());

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        const onAbort = () => {
            clearTimeout(timer);
            cleanup();
            reject(makeAbortError());
        };

        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        signal?.addEventListener("abort", onAbort, {once: true});
    });
}

function raceWithAbort(promise, signal = null) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(makeAbortError());

    return new Promise((resolve, reject) => {
        const onAbort = () => {
            cleanup();
            reject(makeAbortError());
        };
        const cleanup = () => signal.removeEventListener("abort", onAbort);

        signal.addEventListener("abort", onAbort, {once: true});
        Promise.resolve(promise).then(value => {
            cleanup();
            resolve(value);
        }, error => {
            cleanup();
            reject(error);
        });
    });
}

function snapshotState({includeResults = true} = {}) {
    return {
        running: !!state.running,
        status: state.status,
        activeTabId: state.activeTabId,
        currentId: state.currentId,
        total: state.total,
        completed: state.completed,
        remaining: state.remaining,
        results: includeResults ? state.results : undefined,
        resultCount: state.results.length,
        logs: state.logs.slice(),
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
        lastError: state.lastError,
        mode: normalizeRunMode(state.mode)
    };
}

function schedulePersist() {
    if (persistTimer) return;
    persistTimer = setTimeout(async () => {
        persistTimer = null;
        try {
            await chrome.storage.session.set({[STATE_KEY]: snapshotState({includeResults: true})});
        } catch (error) {
            console.warn("Could not persist run state:", error);
        }
    }, 75);
}

function broadcastState() {
    schedulePersist();
    chrome.runtime.sendMessage({
        type: "DORMANT_RUN_STATE_CHANGED", state: snapshotState({includeResults: false})
    }).catch(() => {
        // No popup is currently open. The run intentionally continues.
    });
}

function logStatus(message) {
    const entry = {
        time: new Date().toISOString(), message: String(message)
    };
    state.logs.push(entry);
    if (state.logs.length > MAX_LOG_LINES) {
        state.logs.splice(0, state.logs.length - MAX_LOG_LINES);
    }
    console.log(`[Dormant LEGO] ${entry.message}`);
    broadcastState();
}

async function ensureInitialized() {
    if (initialized) return;
    if (initializationPromise) return initializationPromise;

    initializationPromise = (async () => {
        try {
            const saved = (await chrome.storage.session.get(STATE_KEY))?.[STATE_KEY];
            if (saved && typeof saved === "object") {
                state = {
                    ...cloneDefaultState(), ...saved,
                    results: Array.isArray(saved.results) ? saved.results : [],
                    logs: Array.isArray(saved.logs) ? saved.logs : [],
                    mode: normalizeRunMode(saved.mode)
                };

                // A service-worker restart cannot retain the active AbortController
                // or JavaScript call stack. Mark a stale run honestly as interrupted.
                if (state.running) {
                    state.running = false;
                    state.status = "interrupted";
                    state.activeTabId = null;
                    state.finishedAt = new Date().toISOString();
                    state.logs.push({
                        time: new Date().toISOString(),
                        message: "Background worker restarted; the previous run was interrupted."
                    });
                }
            }
        } catch (error) {
            console.warn("Could not restore run state:", error);
        }
        initialized = true;
        schedulePersist();
    })();

    return initializationPromise;
}

function throwIfStopped(generation, signal) {
    if (signal?.aborted || generation !== runGeneration || !state.running) {
        throw makeAbortError();
    }
}

function buildUrl(template, id) {
    return String(template).replace(/\{id\}/g, encodeURIComponent(id));
}

function isAssetS3PageUrl(rawUrl) {
    try {
        return new URL(rawUrl || "").hostname === "lac-bucket-assets-prod.s3.eu-west-1.amazonaws.com";
    } catch {
        return false;
    }
}

function isAssetsPageUrl(rawUrl) {
    try {
        return /\/products\/[^/]+\/29\/assets\/?$/.test(new URL(rawUrl || "").pathname);
    } catch {
        return false;
    }
}

async function getTabUrl(tabId) {
    try {
        return (await chrome.tabs.get(tabId))?.url || "";
    } catch {
        return "";
    }
}

async function waitForTabComplete(tabId, timeoutMs = 30000, pollMs = 300, signal = null) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        if (signal?.aborted) throw makeAbortError();
        try {
            const tab = await chrome.tabs.get(tabId);
            if (tab?.status === "complete") return true;
        } catch (error) {
            if (isAbortError(error)) throw error;
        }
        await sleep(pollMs, signal);
    }
    return false;
}

async function checkNotFound(tabId) {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {tabId}, func: () => {
                try {
                    const norm = value => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
                    if (Array.from(document.querySelectorAll("h1")).some(h => norm(h.textContent) === "content could not be found")) {
                        return true;
                    }
                    return !!document.body && norm(document.body.textContent).includes("content could not be found");
                } catch {
                    return false;
                }
            }
        });
        return !!res?.result;
    } catch {
        return false;
    }
}

async function waitUntilReadyOrNotFound(tabId, {
    timeoutMs = 20000, intervalMs = 400, minValued = 2, generation, signal
} = {}) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        throwIfStopped(generation, signal);

        if (await checkNotFound(tabId)) {
            throwIfStopped(generation, signal);
            return {ready: false, notFound: true};
        }

        try {
            const [res] = await chrome.scripting.executeScript({
                target: {tabId}, func: min => {
                    try {
                        const api = window.__DormantScraper__;
                        return !!api?.isReady?.(min);
                    } catch {
                        return false;
                    }
                }, args: [minValued]
            });
            throwIfStopped(generation, signal);
            if (res?.result) return {ready: true, notFound: false};
        } catch (error) {
            if (isAbortError(error)) throw error;
        }

        await sleep(intervalMs, signal);
    }

    return {ready: false, notFound: false};
}

async function scrapeCurrentTab(tabId, signal = null) {
    if (signal?.aborted) throw makeAbortError();
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {tabId}, func: () => {
                const api = window.__DormantScraper__;
                if (!api) return null;
                if (typeof api.run === "function") return api.run();
                if (typeof api.toJSON === "function") {
                    try {
                        return JSON.parse(api.toJSON());
                    } catch {
                        return null;
                    }
                }
                return null;
            }
        });
        if (signal?.aborted) throw makeAbortError();
        return res?.result || null;
    } catch (error) {
        if (isAbortError(error)) throw error;
        logStatus(`Scrape error: ${error?.message || error}`);
        return null;
    }
}

async function getCurrentAssetPlan(tabId, signal = null) {
    if (signal?.aborted) throw makeAbortError();
    const task = chrome.scripting.executeScript({
        target: {tabId}, func: () => {
            const api = window.__DormantScraper__;
            return typeof api?.assetPlan === "function" ? api.assetPlan() : [];
        }
    });
    const [res] = await raceWithAbort(task, signal);
    return Array.isArray(res?.result) ? res.result : [];
}

async function downloadCurrentAsset(tabId, label, signal = null) {
    if (signal?.aborted) throw makeAbortError();
    try {
        const task = chrome.scripting.executeScript({
            target: {tabId}, func: async assetLabel => {
                const api = window.__DormantScraper__;
                if (typeof api?.downloadAsset !== "function") {
                    return {ok: false, label: assetLabel, error: "downloadAsset API missing"};
                }
                return await api.downloadAsset(assetLabel);
            }, args: [label]
        });
        const [res] = await raceWithAbort(task, signal);
        return res?.result || {ok: false, label, error: "empty-download-result"};
    } catch (error) {
        if (isAbortError(error)) throw error;
        return {ok: false, label, executionError: error?.message || String(error)};
    }
}

async function detectAccessDeniedAssetPage(tabId, timeoutMs = 3000, signal = null) {
    const started = Date.now();

    while (Date.now() - started < timeoutMs) {
        if (signal?.aborted) throw makeAbortError();

        let tab;
        try {
            tab = await chrome.tabs.get(tabId);
        } catch {
            return false;
        }

        if (!isAssetS3PageUrl(tab?.url || "")) {
            await sleep(100, signal);
            continue;
        }

        if (tab.status !== "complete") {
            await sleep(100, signal);
            continue;
        }

        try {
            const [res] = await chrome.scripting.executeScript({
                target: {tabId},
                func: () => /access\s*denied/i.test(String(document.documentElement?.textContent || document.body?.textContent || ""))
            });
            return !!res?.result;
        } catch {
            return true;
        }
    }

    return false;
}

async function restoreAssetsPage(tabId, assetsUrl, generation, signal) {
    throwIfStopped(generation, signal);
    await chrome.tabs.update(tabId, {url: assetsUrl});
    throwIfStopped(generation, signal);

    const loaded = await waitForTabComplete(tabId, 45000, 300, signal);
    if (!loaded) return false;

    const readyState = await waitUntilReadyOrNotFound(tabId, {
        timeoutMs: 12000, intervalMs: 400, minValued: 1, generation, signal
    });
    return !readyState.notFound;
}

async function downloadCurrentAssets(tabId, assetsUrl, generation, signal = null) {
    throwIfStopped(generation, signal);

    let plan;
    try {
        plan = await getCurrentAssetPlan(tabId, signal);
    } catch (error) {
        if (isAbortError(error)) throw error;
        return {ok: false, error: error?.message || String(error), downloaded: [], failed: []};
    }

    const downloaded = [];
    const failed = [];

    for (let index = 0; index < plan.length; index++) {
        throwIfStopped(generation, signal);

        const label = plan[index]?.label || `asset-${index + 1}`;
        const result = await downloadCurrentAsset(tabId, label, signal);
        throwIfStopped(generation, signal);

        const accessDenied = await detectAccessDeniedAssetPage(tabId, result?.ok ? 1200 : 4000, signal);
        throwIfStopped(generation, signal);

        if (accessDenied) {
            failed.push({label, reason: "access-denied-not-finalized"});
            const hasNextAsset = index + 1 < plan.length;

            if (hasNextAsset) {
                logStatus(`Asset ${label}: AccessDenied; returning to assets and continuing`);
                const restored = await restoreAssetsPage(tabId, assetsUrl, generation, signal);
                if (!restored) {
                    failed.push({label, reason: "could-not-return-to-assets-page"});
                    return {ok: false, found: plan.length, downloaded, failed, recoveryFailed: true};
                }
                await sleep(600, signal);
            } else {
                logStatus(`Asset ${label}: AccessDenied on final image; continuing to next product`);
            }
            continue;
        }

        if (result?.ok) {
            downloaded.push({label, via: result.via || "download"});
        } else {
            failed.push({
                label, reason: result?.reason || result?.error || result?.executionError || "download-failed"
            });
            if (result?.fatal) break;
        }

        const currentUrl = await getTabUrl(tabId);
        throwIfStopped(generation, signal);
        if (!isAssetsPageUrl(currentUrl || assetsUrl)) {
            failed.push({label, reason: "unexpected-navigation-after-download"});
            break;
        }

        await sleep(700, signal);
    }

    return {ok: true, found: plan.length, downloaded, failed};
}

async function cancelCurrentAssets(tabId) {
    if (!tabId) return false;

    try {
        const response = await chrome.tabs.sendMessage(tabId, {type: "DORMANT_CANCEL_DOWNLOADS"});
        return !!response?.cancelled;
    } catch {
        try {
            const [res] = await chrome.scripting.executeScript({
                target: {tabId},
                func: () => typeof window.__DormantScraper__?.cancelDownloads === "function" ? window.__DormantScraper__.cancelDownloads() : false
            });
            return !!res?.result;
        } catch {
            return false;
        }
    }
}

async function processProduct(tabId, template, id, mode, generation, signal) {
    const normalizedMode = normalizeRunMode(mode);
    const wantsData = normalizedMode !== RUN_MODES.IMAGES_ONLY;
    const wantsImages = normalizedMode !== RUN_MODES.DATA_ONLY;

    const textUrl = buildUrl(template, id);
    const dataUrl = textUrl.replace(/\/text(\b|$)/, "/data");
    const assetsUrl = `https://content.lego.com/products/${encodeURIComponent(id)}/29/assets`;

    let merged = null;

    if (wantsData) {
        // PHASE 1: /text
        throwIfStopped(generation, signal);
        state.status = "loading-text";
        broadcastState();
        logStatus(`Loading ${textUrl}`);
        await chrome.tabs.update(tabId, {url: textUrl});

        const textLoaded = await waitForTabComplete(tabId, 45000, 300, signal);
        if (!textLoaded) logStatus(`Timeout waiting for ${id} /text`);

        const textState = await waitUntilReadyOrNotFound(tabId, {
            timeoutMs: 20000, intervalMs: 400, minValued: 2, generation, signal
        });

        if (textState.notFound) {
            logStatus(`Skipping ${id}: content not found at /text`);
            return {skip: true, record: null};
        }
        if (!textState.ready) logStatus(`Content not ready after 20s for ${id} /text; proceeding`);
        await sleep(300, signal);
        const textRecord = await scrapeCurrentTab(tabId, signal) || {};

        // PHASE 2: /data
        throwIfStopped(generation, signal);
        state.status = "loading-data";
        broadcastState();
        logStatus(`Loading ${dataUrl}`);
        await chrome.tabs.update(tabId, {url: dataUrl});

        const dataLoaded = await waitForTabComplete(tabId, 45000, 300, signal);
        if (!dataLoaded) logStatus(`Timeout waiting for ${id} /data`);

        const dataState = await waitUntilReadyOrNotFound(tabId, {
            timeoutMs: 20000, intervalMs: 400, minValued: 2, generation, signal
        });

        merged = {...textRecord};
        if (dataState.notFound) {
            logStatus(`No /data for ${id}; continuing without age/pieces/dimensions`);
        } else {
            if (!dataState.ready) logStatus(`Content not ready after 20s for ${id} /data; proceeding`);
            await sleep(300, signal);
            const dataRecord = await scrapeCurrentTab(tabId, signal) || {};
            merged = {...merged, ...dataRecord};
        }
    }

    if (wantsImages) {
        // PHASE 3: /assets
        throwIfStopped(generation, signal);
        state.status = "downloading-assets";
        broadcastState();
        logStatus(`Loading ${assetsUrl}`);
        await chrome.tabs.update(tabId, {url: assetsUrl});

        const assetsLoaded = await waitForTabComplete(tabId, 45000, 300, signal);
        if (!assetsLoaded) logStatus(`Timeout waiting for ${id} /assets`);

        const assetsState = await waitUntilReadyOrNotFound(tabId, {
            timeoutMs: 12000, intervalMs: 400, minValued: 1, generation, signal
        });

        if (assetsState.notFound) {
            logStatus(`No /assets for ${id}; continuing without asset downloads`);
        } else {
            if (!assetsState.ready) logStatus(`Assets not marked ready for ${id}; attempting downloads anyway`);
            await sleep(800, signal);

            const assetResult = await downloadCurrentAssets(tabId, assetsUrl, generation, signal) || {};
            const done = Array.isArray(assetResult.downloaded) ? assetResult.downloaded : [];
            const failed = Array.isArray(assetResult.failed) ? assetResult.failed : [];

            logStatus(`Assets ${id}: downloaded ${done.length}${failed.length ? `, failed ${failed.length}` : ""}`);
            if (done.length) logStatus(`Downloaded labels: ${done.map(item => `${item.label} [${item.via}]`).join(", ")}`);
            if (failed.length) logStatus(`Failed labels: ${failed.map(item => `${item.label} (${item.reason})`).join(", ")}`);
        }
    }

    if (merged) {
        logStatus(`Scraped ${id} → XML fields: ${Object.keys(merged).length} ` + `(Age=${merged.age ?? "-"} Pieces=${merged.pieces ?? "-"} ` + `DimB LxWxH=${merged.dimB_length ?? "-"}x${merged.dimB_width ?? "-"}x${merged.dimB_height ?? "-"})`);
    } else {
        logStatus(`Images completed for ${id}`);
    }

    return {skip: false, record: merged};
}

async function runQueue({tabId, ids, template, mode, generation, signal}) {
    try {
        for (let index = 0; index < ids.length; index++) {
            throwIfStopped(generation, signal);

            const id = ids[index];
            state.currentId = id;
            state.remaining = ids.length - index;
            broadcastState();

            try {
                const productResult = await processProduct(tabId, template, id, mode, generation, signal);
                throwIfStopped(generation, signal);
                if (!productResult.skip && productResult.record) {
                    state.results.push(productResult.record);
                }
            } catch (error) {
                if (isAbortError(error)) throw error;
                state.lastError = error?.message || String(error);
                logStatus(`Error on ${id}: ${state.lastError}`);
            }

            state.completed = index + 1;
            state.remaining = ids.length - state.completed;
            broadcastState();
        }

        throwIfStopped(generation, signal);
        state.running = false;
        state.status = "completed";
        state.currentId = "";
        state.activeTabId = null;
        state.remaining = 0;
        state.finishedAt = new Date().toISOString();
        runAbortController = null;
        if (normalizeRunMode(mode) === RUN_MODES.IMAGES_ONLY) {
            logStatus(`Done. ${state.completed} products processed for images.`);
        } else {
            logStatus(`Done. ${state.results.length} records.`);
        }
    } catch (error) {
        if (isAbortError(error)) {
            return;
        }

        state.running = false;
        state.status = "error";
        state.activeTabId = null;
        state.finishedAt = new Date().toISOString();
        state.lastError = error?.message || String(error);
        runAbortController = null;
        logStatus(`Run failed: ${state.lastError}`);
    } finally {
        schedulePersist();
        broadcastState();
    }
}

async function startRun({tabId, ids, template, mode}) {
    await ensureInitialized();

    if (state.running) {
        return {ok: false, error: "A run is already active", state: snapshotState({includeResults: false})};
    }
    if (!Number.isInteger(tabId)) return {ok: false, error: "No valid active tab"};
    if (!Array.isArray(ids) || !ids.length) return {ok: false, error: "No product IDs"};
    const normalizedMode = normalizeRunMode(mode);
    if (normalizedMode !== RUN_MODES.IMAGES_ONLY && !String(template || "").includes("{id}")) {
        return {ok: false, error: "URL template must contain {id} for data runs"};
    }

    runGeneration++;
    const generation = runGeneration;
    const controller = new AbortController();
    runAbortController = controller;

    state = {
        ...cloneDefaultState(),
        running: true,
        status: "starting",
        activeTabId: tabId,
        total: ids.length,
        remaining: ids.length,
        startedAt: new Date().toISOString(),
        mode: normalizedMode
    };

    logStatus(`Starting ${runModeLabel(normalizedMode)} in background. ${ids.length} IDs queued.`);
    void runQueue({
        tabId,
        ids: ids.slice(),
        template: String(template || ""),
        mode: normalizedMode,
        generation,
        signal: controller.signal
    });

    return {ok: true, state: snapshotState({includeResults: false})};
}

async function stopRun({clearQueue = false} = {}) {
    await ensureInitialized();
    const tabId = state.activeTabId;

    runGeneration++;
    state.running = false;
    state.status = "stopped";
    state.currentId = "";
    state.activeTabId = null;
    state.remaining = 0;
    state.finishedAt = new Date().toISOString();
    runAbortController?.abort();
    runAbortController = null;

    if (clearQueue) {
        state.results = [];
        state.completed = 0;
        state.total = 0;
        state.logs = [];
        state.status = "idle";
        state.startedAt = null;
        state.finishedAt = null;
        state.lastError = "";
    } else {
        logStatus("Stopped immediately");
    }

    broadcastState();
    void cancelCurrentAssets(tabId);
    return {ok: true, state: snapshotState({includeResults: false})};
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
        await ensureInitialized();

        switch (message?.type) {
            case "DORMANT_GET_RUN_STATE":
                sendResponse({ok: true, state: snapshotState({includeResults: true})});
                return;

            case "DORMANT_START_RUN":
                sendResponse(await startRun(message));
                return;

            case "DORMANT_STOP_RUN":
                sendResponse(await stopRun());
                return;

            case "DORMANT_CLEAR_RUN":
                sendResponse(await stopRun({clearQueue: true}));
                return;

            default:
                return;
        }
    })().catch(error => {
        sendResponse({ok: false, error: error?.message || String(error)});
    });

    return true;
});

chrome.runtime.onInstalled.addListener(() => {
    void ensureInitialized();
});

void ensureInitialized();
