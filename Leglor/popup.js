/* popup.js — detachable UI for the background service-worker controller. */

function qs(selector) {
    return document.querySelector(selector);
}

const statusEl = qs("#status");
const idsEl = qs("#ids");
const btnStartAll = qs("#start-all");
const btnStartData = qs("#start-data");
const btnStartImages = qs("#start-images");
const startButtons = [btnStartAll, btnStartData, btnStartImages];
const btnStop = qs("#stop");
const btnSave = qs("#save");
const btnClear = qs("#clear");

let currentState = null;

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
    btn.style.opacity = btn.disabled ? "0.55" : "1";
    btn.style.pointerEvents = btn.disabled ? "none" : "auto";
}

function setButtonsDuringRun(running, canSave = false) {
    for (const button of startButtons) button.disabled = running;
    btnStop.disabled = !running;
    btnSave.disabled = running || !canSave;
    [...startButtons, btnStop, btnSave].forEach(syncBtnDisabledVisual);
}

function parseIds(raw) {
    return Array.from(new Set(String(raw || "").split(/[\s,;]+/).map(value => value.trim()).filter(Boolean)));
}

function formatLogTime(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
}

function runModeLabel(mode) {
    if (mode === "data-only") return "Data only";
    if (mode === "images-only") return "Images only";
    return "Data + images";
}

function renderState(nextState) {
    if (!nextState) return;
    currentState = {...(currentState || {}), ...nextState};

    const running = !!currentState.running;
    const resultCount = Number(currentState.resultCount ?? currentState.results?.length ?? 0);
    setButtonsDuringRun(running, resultCount > 0);

    const logs = Array.isArray(currentState.logs) ? currentState.logs : [];
    const lines = logs.map(entry => `[${formatLogTime(entry.time)}] ${entry.message}`);

    if (running) {
        const progress = `${currentState.completed || 0}/${currentState.total || 0}`;
        const current = currentState.currentId ? ` — ${currentState.currentId}` : "";
        lines.push(`[background] Running ${runModeLabel(currentState.mode)} ${progress}${current}. You may close this panel.`);
    } else if (!lines.length) {
        lines.push("[background] Idle. Runs continue after this panel closes.");
    }

    statusEl.textContent = lines.join("\n");
    statusEl.scrollTop = statusEl.scrollHeight;
}

async function sendMessage(message) {
    try {
        return await chrome.runtime.sendMessage(message);
    } catch (error) {
        return {ok: false, error: error?.message || String(error)};
    }
}

async function refreshState() {
    const response = await sendMessage({type: "DORMANT_GET_RUN_STATE"});
    if (response?.ok) renderState(response.state); else statusEl.textContent = `Could not read background state: ${response?.error || "unknown error"}`;
}

const OUTPUT_COLUMNS = ["bulletLong", "bulletShort", "description", "header", "name", "productId", "quickView", "shopperName", "titleLong", "titleMedium", "titleShort", "url", "age", "pieces", "pieceBarcode", "dimB_altUoM", "dimB_qty", "dimB_qtyInBU", "dimB_length", "dimB_width", "dimB_height", "dimB_dimUnit", "dimB_volume", "dimB_volumeUnit", "dimB_netWeight", "dimB_grossWeight", "dimB_tareWeight", "dimB_weightUnit"];

function toCellString(value) {
    if (Array.isArray(value)) return value.map(item => item ?? "").join(" | ");
    if (value && typeof value === "object") return JSON.stringify(value);
    return value == null ? "" : String(value);
}

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function buildXml(records) {
    const parts = [];
    parts.push(`<?xml version="1.0"?>`);
    parts.push(`<?mso-application progid="Excel.Sheet"?>`);
    parts.push(`<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
    xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:x="urn:schemas-microsoft-com:office:excel"
    xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">`);
    parts.push(`<Worksheet ss:Name="Sheet1"><Table>`);
    parts.push(`<Row>`);
    for (const column of OUTPUT_COLUMNS) {
        parts.push(`<Cell><Data ss:Type="String">${xmlEscape(column)}</Data></Cell>`);
    }
    parts.push(`</Row>`);

    for (const record of records) {
        parts.push(`<Row>`);
        for (const column of OUTPUT_COLUMNS) {
            parts.push(`<Cell><Data ss:Type="String">${xmlEscape(toCellString(record?.[column]))}</Data></Cell>`);
        }
        parts.push(`</Row>`);
    }

    parts.push(`</Table></Worksheet></Workbook>`);
    return parts.join("");
}

document.addEventListener("DOMContentLoaded", async () => {
    applyBtnCss(btnStartAll, ["#667eea", "#764ba2"]);
    applyBtnCss(btnStartData, ["#0575E6", "#021B79"]);
    applyBtnCss(btnStartImages, ["#11998e", "#38ef7d"]);
    applyBtnCss(btnSave, ["#f7971e", "#ffd200"]);
    applyBtnCss(btnStop, ["#d50000", "#00a152"]);
    applyBtnCss(btnClear, ["#636363", "#a2ab58"]);
    [...startButtons, btnStop, btnSave, btnClear].forEach(syncBtnDisabledVisual);

    try {
        const {lego_ids} = await chrome.storage.local.get(["lego_ids"]);

        if (typeof lego_ids === "string" && lego_ids.trim()) {
            idsEl.value = lego_ids;
        }
    } catch {
        // Leave the product ID input empty if storage cannot be read.
    }

    await refreshState();

    async function startWithMode(mode) {
        const ids = parseIds(idsEl.value);
        const template = "https://content.lego.com/products/{id}/29/text";
        const needsTemplate = mode !== "images-only";

        if (!ids.length) {
            statusEl.textContent += "\nProvide at least one product ID";
            return;
        }
        if (needsTemplate && !template.includes("{id}")) {
            statusEl.textContent += "\nProvide a URL template containing {id} for data runs";
            return;
        }

        const [activeTab] = await chrome.tabs.query({active: true, lastFocusedWindow: true});
        if (!activeTab?.id) {
            statusEl.textContent += "\nNo active tab";
            return;
        }

        await chrome.storage.local.set({
            lego_ids: idsEl.value
        });

        const response = await sendMessage({
            type: "DORMANT_START_RUN", tabId: activeTab.id, ids, template, mode
        });

        if (response?.ok) renderState(response.state); else statusEl.textContent += `\nStart failed: ${response?.error || "unknown error"}`;
    }

    btnStartAll.addEventListener("click", () => startWithMode("data-and-images"));
    btnStartData.addEventListener("click", () => startWithMode("data-only"));
    btnStartImages.addEventListener("click", () => startWithMode("images-only"));

    btnStop.addEventListener("click", async () => {
        const response = await sendMessage({type: "DORMANT_STOP_RUN"});
        if (response?.ok) renderState(response.state); else statusEl.textContent += `\nStop failed: ${response?.error || "unknown error"}`;
    });

    btnClear.addEventListener("click", async () => {
        idsEl.value = "";
        await chrome.storage.local.set({lego_ids: ""});
        const response = await sendMessage({type: "DORMANT_CLEAR_RUN"});
        if (response?.ok) renderState(response.state); else statusEl.textContent += `\nClear failed: ${response?.error || "unknown error"}`;
    });

    btnSave.addEventListener("click", async () => {
        const response = await sendMessage({type: "DORMANT_GET_RUN_STATE"});
        if (!response?.ok) {
            statusEl.textContent += `\nCould not read results: ${response?.error || "unknown error"}`;
            return;
        }

        const records = Array.isArray(response.state?.results) ? response.state.results : [];
        const xml = buildXml(records);
        const blob = new Blob([xml], {type: "application/xml"});
        const url = URL.createObjectURL(blob);
        const filename = `lego-scrape-${new Date().toISOString().replace(/[:.]/g, "-")}.xml`;

        try {
            await chrome.downloads.download({url, filename, saveAs: false});
            statusEl.textContent += `\nXML downloaded (${records.length} records)`;
        } catch (error) {
            statusEl.textContent += `\nDownload failed: ${error?.message || String(error)}`;
        } finally {
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        }
    });
});

chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "DORMANT_RUN_STATE_CHANGED" && message.state) {
        renderState(message.state);
    }
});
