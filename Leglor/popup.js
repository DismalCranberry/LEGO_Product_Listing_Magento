/* popup.js — MV3 popup controller. Loads slow pages, verifies content readiness, scrapes, exports SpreadsheetML XML. */

function qs(sel) {
    return document.querySelector(sel);
}

const statusEl = qs("#status");
const idsEl = qs("#ids");
const tmplEl = qs("#tmpl");
const btnStart = qs("#start");
const btnStop = qs("#stop");
const btnSave = qs("#save");
const btnClear = qs("#clear");

let running = false;
let results = [];
let queue = [];

/* ---------- Fancy gradient button style ---------- */
function applyBtnCss(btn, colors = ["#4A00E0", "#8E2DE2"]) {
    btn.style.cssText += `
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 10px 22px;
    margin: 6px 6px 0 0;
    border: none;
    border-radius: 12px;
    background: linear-gradient(90deg, ${colors[0]}, ${colors[1]});
    color: #fff;
    font: 600 13px/1 system-ui, sans-serif;
    cursor: pointer;
    user-select: none;
    box-shadow: 0 4px 10px rgba(0,0,0,.25);
    transition: transform .15s ease, box-shadow .15s ease, filter .15s ease;
    overflow: hidden;
  `;

    btn.onmouseenter = () => {
        if (!btn.disabled) {
            btn.style.transform = "translateY(-2px)";
            btn.style.filter = "brightness(1.1)";
        }
    };
    btn.onmouseleave = () => {
        btn.style.transform = "translateY(0)";
        btn.style.filter = "none";
    };
    btn.onmousedown = () => {
        if (!btn.disabled) btn.style.transform = "scale(0.97)";
    };
    btn.onmouseup = () => {
        if (!btn.disabled) btn.style.transform = "translateY(-2px)";
    };
}

function syncBtnDisabledVisual(btn) {
    const isDis = !!btn.disabled;
    btn.style.opacity = isDis ? "0.55" : "1";
    btn.style.pointerEvents = isDis ? "none" : "auto";
}

/* ---------- Status UI ---------- */
function logStatus(msg) {
    const line = document.createElement("div");
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${msg}`;
    statusEl.appendChild(line);
    statusEl.scrollTop = statusEl.scrollHeight;
}

function setButtonsDuringRun(state) {
    btnStart.disabled = state;
    btnStop.disabled = !state;
    btnSave.disabled = state;
    [btnStart, btnStop, btnSave].forEach(syncBtnDisabledVisual);
}

/* ---------- Input helpers ---------- */
function parseIds(raw) {
    return Array.from(new Set((raw || "")
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean)));
}

function buildUrl(tmpl, id) {
    return String(tmpl).replace(/\{id\}/g, encodeURIComponent(id));
}

function isExpiredAssetPageUrl(rawUrl) {
    try {
        const u = new URL(rawUrl || "");
        return u.hostname === "lac-bucket-assets-prod.s3.eu-west-1.amazonaws.com";
    } catch {
        return false;
    }
}

async function getTabUrl(tabId) {
    try {
        const tab = await chrome.tabs.get(tabId);
        return tab?.url || "";
    } catch {
        return "";
    }
}

/* ---------- Tab + content readiness ---------- */
function waitForTabComplete(tabId, timeoutMs = 30000, pollMs = 300) {
    const t0 = Date.now();
    return new Promise((resolve) => {
        const tick = async () => {
            try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.status === "complete") return resolve(true);
            } catch {
            }
            if (Date.now() - t0 >= timeoutMs) return resolve(false);
            setTimeout(tick, pollMs);
        };
        tick();
    });
}

async function checkNotFound(tabId) {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {tabId}, func: () => {
                try {
                    const norm = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
                    if (Array.from(document.querySelectorAll("h1")).some(h => norm(h.textContent) === "content could not be found")) {
                        return true;
                    }
                    return !!(document.body && norm(document.body.textContent).includes("content could not be found"));
                } catch {
                    return false;
                }
            }
        });
        return !!(res && res.result);
    } catch (e) {
        logStatus(`checkNotFound error: ${e?.message || e}`);
        return false;
    }
}

async function waitUntilReadyOrNotFound(tabId, {
    timeoutMs = 20000, intervalMs = 400, minValued = 2
} = {}) {
    const t0 = Date.now();

    while (Date.now() - t0 < timeoutMs) {
        if (await checkNotFound(tabId)) {
            return {ready: false, notFound: true};
        }

        try {
            const [res] = await chrome.scripting.executeScript({
                target: {tabId}, func: (min) => {
                    try {
                        const api = window.__DormantScraper__;
                        if (!api || typeof api.isReady !== "function") return false;
                        return !!api.isReady(min);
                    } catch {
                        return false;
                    }
                }, args: [minValued]
            });

            if (res && res.result) return {ready: true, notFound: false};
        } catch (e) {
            logStatus(`readiness poll error: ${e?.message || e}`);
        }
        await new Promise(r => setTimeout(r, intervalMs));
    }
    return {ready: false, notFound: false};
}

/* ---------- Scrape ---------- */
async function scrapeCurrentTab(tabId) {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {tabId}, func: () => {
                const api = window.__DormantScraper__;
                if (!api) return null;

                if (typeof api.run === "function") {
                    return api.run();
                }

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

        return res ? res.result : null;
    } catch (e) {
        logStatus(`scrape error: ${e?.message || e}`);
        return null;
    }
}

async function downloadCurrentAssets(tabId) {
    try {
        const [res] = await chrome.scripting.executeScript({
            target: {tabId}, func: async () => {
                const api = window.__DormantScraper__;
                if (!api || typeof api.downloadAssets !== "function") {
                    return {ok: false, error: "downloadAssets API missing"};
                }
                return await api.downloadAssets();
            }
        });

        return res ? res.result : null;
    } catch (e) {
        logStatus(`asset download error: ${e?.message || e}`);
        return {ok: false, error: e?.message || String(e)};
    }
}

/* ---------- Column order for export ---------- */
const OUTPUT_COLUMNS = ["bulletLong", "bulletShort", "description", "header", "name", "productId", "quickView", "shopperName", "titleLong", "titleMedium", "titleShort", "url", "age", "pieces", "pieceBarcode", "dimB_altUoM", "dimB_qty", "dimB_qtyInBU", "dimB_length", "dimB_width", "dimB_height", "dimB_dimUnit", "dimB_volume", "dimB_volumeUnit", "dimB_netWeight", "dimB_grossWeight", "dimB_tareWeight", "dimB_weightUnit"];

/* ---------- SpreadsheetML XML ---------- */
function _toCellString(v) {
    if (Array.isArray(v)) return v.map(x => (x ?? "")).join(" | ");
    if (v && typeof v === "object") return JSON.stringify(v);
    return v == null ? "" : String(v);
}

function _xmlEsc(s) {
    return String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function buildXml(records) {
    const p = [];
    p.push(`<?xml version="1.0"?>`);
    p.push(`<?mso-application progid="Excel.Sheet"?>`);
    p.push(`<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`);
    p.push(`<Worksheet ss:Name="Sheet1"><Table>`);

    p.push(`<Row>`);
    for (const col of OUTPUT_COLUMNS) {
        p.push(`<Cell><Data ss:Type="String">${_xmlEsc(col)}</Data></Cell>`);
    }
    p.push(`</Row>`);

    for (const rec of records) {
        p.push(`<Row>`);
        for (const col of OUTPUT_COLUMNS) {
            const val = _toCellString(rec?.[col]);
            p.push(`<Cell><Data ss:Type="String">${_xmlEsc(val)}</Data></Cell>`);
        }
        p.push(`</Row>`);
    }

    p.push(`</Table></Worksheet></Workbook>`);
    return p.join("");
}

/* ---------- Stepper ---------- */
async function step(tabId, tmpl) {
    if (!running) return;

    const id = queue.shift();
    if (!id) {
        running = false;
        setButtonsDuringRun(false);
        logStatus(`Done. ${results.length} records.`);
        return;
    }

    const textUrl = buildUrl(tmpl, id);
    const dataUrl = textUrl.replace(/\/text(\b|$)/, "/data");

    try {
        // PHASE 1: /text
        logStatus(`Loading ${textUrl}`);
        await chrome.tabs.update(tabId, {url: textUrl});
        const ok1 = await waitForTabComplete(tabId, 45000);
        if (!ok1) logStatus(`Timeout waiting for DOM 'complete' for ${id} (/text)`);

        const {ready: r1, notFound: nf1} = await waitUntilReadyOrNotFound(tabId, {
            timeoutMs: 20000, intervalMs: 400, minValued: 2
        });

        if (nf1) {
            logStatus(`Skipping ${id}: content not found at /text`);
            if (running) step(tabId, tmpl);
            return;
        }

        if (!r1) logStatus(`Content not ready after 20s for ${id} (/text); proceeding`);
        await new Promise(r => setTimeout(r, 300));
        const textRec = await scrapeCurrentTab(tabId) || {};

        // PHASE 2: /data
        logStatus(`Loading ${dataUrl}`);
        await chrome.tabs.update(tabId, {url: dataUrl});
        const ok2 = await waitForTabComplete(tabId, 45000);
        if (!ok2) logStatus(`Timeout waiting for DOM 'complete' for ${id} (/data)`);

        const {ready: r2, notFound: nf2} = await waitUntilReadyOrNotFound(tabId, {
            timeoutMs: 20000, intervalMs: 400, minValued: 2
        });

        let merged = {...textRec};

        if (nf2) {
            logStatus(`No /data for ${id}; continuing without age/pieces/dimensions`);
        } else {
            await new Promise(r => setTimeout(r, 300));
            const dataRec = await scrapeCurrentTab(tabId) || {};
            merged = {...merged, ...dataRec};
        }

        // PHASE 3: /assets
        const assetsUrl = `https://content.lego.com/products/${encodeURIComponent(id)}/29/assets`;
        logStatus(`Loading ${assetsUrl}`);
        await chrome.tabs.update(tabId, {url: assetsUrl});
        const ok3 = await waitForTabComplete(tabId, 45000);
        if (!ok3) logStatus(`Timeout waiting for DOM 'complete' for ${id} (/assets)`);

        const {ready: r3, notFound: nf3} = await waitUntilReadyOrNotFound(tabId, {
            timeoutMs: 12000, intervalMs: 400, minValued: 1
        });

        if (nf3) {
            logStatus(`No /assets for ${id}; continuing without asset downloads`);
        } else {
            if (!r3) {
                logStatus(`Assets not marked ready for ${id}; attempting downloads anyway`);
            }

            await new Promise(r => setTimeout(r, 800));

            const assetResult = await downloadCurrentAssets(tabId) || {};
            const done = Array.isArray(assetResult.downloaded) ? assetResult.downloaded : [];
            const failed = Array.isArray(assetResult.failed) ? assetResult.failed : [];

            const currentUrl = await getTabUrl(tabId);

            if (isExpiredAssetPageUrl(currentUrl)) {
                logStatus(`Assets ${id}: redirected to expired S3 page, skipping to next SKU`);
                results.push(merged);
                if (running) step(tabId, tmpl);
                return;
            }

            logStatus(`Assets ${id}: downloaded ${done.length}${failed.length ? `, failed ${failed.length}` : ""}`);

            if (done.length) {
                logStatus(`Downloaded labels: ${done.map(x => `${x.label} [${x.via}]`).join(", ")}`);
            }
            if (failed.length) {
                logStatus(`Failed labels: ${failed.map(x => `${x.label} (${x.reason})`).join(", ")}`);
            }
        }
        results.push(merged);
        logStatus(`Scraped ${id} → XML fields: ${Object.keys(merged).length} (Age=${merged.age ?? "-"} Pieces=${merged.pieces ?? "-"} DimB LxWxH=${merged.dimB_length ?? "-"}x${merged.dimB_width ?? "-"}x${merged.dimB_height ?? "-"})`);
    } catch (e) {
        logStatus(`Error on ${id}: ${e?.message || String(e)}`);
    }

    if (running) step(tabId, tmpl);
}

/* ---------- Wire up ---------- */
document.addEventListener("DOMContentLoaded", async () => {
    applyBtnCss(btnStart, ["#667eea", "#764ba2"]);
    applyBtnCss(btnSave, ["#f7971e", "#ffd200"]);
    applyBtnCss(btnStop, ["#d50000", "#00a152"]);
    applyBtnCss(btnClear, ["#636363", "#a2ab58"]);

    [btnStart, btnStop, btnSave, btnClear].forEach(syncBtnDisabledVisual);

    try {
        const {lego_ids, lego_tmpl} = await chrome.storage.local.get(["lego_ids", "lego_tmpl"]);
        if (typeof lego_ids === "string" && lego_ids.trim()) idsEl.value = lego_ids;
        if (typeof lego_tmpl === "string" && lego_tmpl.trim()) tmplEl.value = lego_tmpl;
    } catch {
    }

    btnClear.addEventListener("click", async () => {
        idsEl.value = "";
        results = [];

        try {
            await chrome.storage.local.set({lego_ids: ""});
        } catch {
        }

        if (!tmplEl.value.trim()) {
            tmplEl.value = "https://content.lego.com/products/{id}/29/text";
        }

        logStatus("Product IDs cleared; template preserved or restored to default");
    });

    btnStart.addEventListener("click", async () => {
        const ids = parseIds(idsEl.value);
        const tmpl = String(tmplEl.value || "").trim();

        if (!ids.length || !tmpl.includes("{id}")) {
            logStatus("Provide IDs and a URL template containing {id}");
            return;
        }

        try {
            await chrome.storage.local.set({lego_ids: idsEl.value, lego_tmpl: tmplEl.value});
        } catch {
        }

        const [activeTab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
        if (!activeTab || !activeTab.id) {
            logStatus("No active tab");
            return;
        }

        results = [];
        queue = ids.slice();
        running = true;
        setButtonsDuringRun(true);
        logStatus(`Starting. ${queue.length} IDs queued.`);

        step(activeTab.id, tmpl);
    });

    btnStop.addEventListener("click", () => {
        running = false;
        setButtonsDuringRun(false);
        logStatus("Stopped");
    });

    btnSave.addEventListener("click", async () => {
        const xml = buildXml(results);
        const blob = new Blob([xml], {type: "application/xml"});
        const url = URL.createObjectURL(blob);
        const filename = `lego-scrape-${new Date().toISOString().replace(/[:.]/g, "-")}.xml`;

        try {
            await chrome.downloads.download({url, filename, saveAs: false});
            logStatus(`XML downloaded (${results.length} records)`);
        } catch (e) {
            logStatus(`Download failed: ${e && e.message ? e.message : String(e)}`);
        }
    });
});