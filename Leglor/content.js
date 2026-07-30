// Dormant page scraper. No work until window.__DormantScraper__.run() is called.
(() => {
    function forceStandardView() {
        const path = location.pathname;
        if (!/\/products\/[^/]+\/29\/text\/?$/.test(path)) return;

        function clickStandardIfPossible() {
            const buttons = Array.from(document.querySelectorAll("button.chakra-button"));
            const standardBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === "standard");
            if (standardBtn) {
                standardBtn.click();
                return true;
            }
            return false;
        }

        clickStandardIfPossible();

        const mo = new MutationObserver(() => clickStandardIfPossible());
        mo.observe(document.body, {childList: true, subtree: true});

        const until = Date.now() + 8000;
        const interval = setInterval(() => {
            if (Date.now() > until) {
                clearInterval(interval);
                mo.disconnect();
                return;
            }
            clickStandardIfPossible();
        }, 400);
    }

    forceStandardView();

    const FIELDS = ["Name", "Shopper Name", "Title Short", "Title Medium", "Title Long", "Header", "Quick View", "Description", "Bullet Short", "Bullet Long"];

    const BASICS_FIELDS = ["Pieces", "Age", "Product", "Item", "Version", "Piece barcode", "Carton Barcode"];

    const ASSET_LABELS = ["Main V29", "Box & Product V29", "Build", "Consumer", "Environment", "Product", "Secondary 01 (No BG)", "Secondary 02 (No BG)"];

    const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
    const keyNorm = (s) => norm(s).toLowerCase();

    function extractProductIdFromURL(u) {
        try {
            const url = new URL(u);
            const parts = url.pathname.split("/").filter(Boolean);
            const idx = parts.indexOf("products");
            if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
        } catch {
        }
        return "";
    }

    function forceStandardTabNow() {
        const path = location.pathname;
        if (!/\/products\/[^/]+\/29\/text\/?$/.test(path)) return;

        const buttons = Array.from(document.querySelectorAll("button.chakra-button"));
        const standardBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === "standard");
        if (standardBtn) standardBtn.click();
    }

    function findRoot() {
        const stacks = Array.from(document.querySelectorAll('div[class*="chakra-stack"]'));
        return stacks.find(el => el.querySelector("p") && (FIELDS.concat(BASICS_FIELDS, ["Dimension"])).some(f => el.textContent?.includes?.(f))) || document.body;
    }

    function findLabelNodes(root, labels) {
        const labelSet = labels.map(keyNorm);
        const map = {};
        const allP = root.querySelectorAll("p");
        for (const p of allP) {
            const k = keyNorm(p.textContent);
            const i = labelSet.indexOf(k);
            if (i >= 0) (map[labels[i]] ||= []).push(p);
        }
        return map;
    }

    function extractFromBlock(labelP) {
        let block = labelP.closest('div[class*="css-hboir"]') || labelP.closest('div[class*="chakra-stack"]') || labelP.parentElement || document.body;

        const sides = Array.from(block.children);
        const rightSide = sides.length > 1 ? sides[1] : block;

        let valuePs = [];
        if (rightSide && rightSide.tagName === "P") {
            valuePs = [rightSide];
        } else {
            valuePs = Array.from(rightSide.querySelectorAll("p"));
        }

        valuePs = valuePs.filter((p) => p !== labelP && norm(p.textContent));

        if (valuePs.length === 0) {
            let cursor = labelP.nextElementSibling;
            while (cursor && !norm(cursor.textContent)) cursor = cursor.nextElementSibling;
            if (cursor) {
                const innerP = cursor.querySelector?.("p");
                const node = innerP || cursor;
                if (norm(node.textContent)) valuePs.push(node);
            }
        }
        return valuePs.map((p) => norm(p.textContent));
    }

    function findSectionRootByTitle(title) {
        const wanted = keyNorm(title);
        const heading = Array.from(document.querySelectorAll("p,h1,h2,h3,h4,h5")).find(el => keyNorm(el.textContent) === wanted);

        return heading?.closest('div[class*="css-1bqan07"]') || heading?.closest('div[class*="chakra-stack"]') || heading?.parentElement || document.body;
    }

    function collectText() {
        const root = findRoot();
        const labels = findLabelNodes(root, FIELDS);

        const out = {
            productId: extractProductIdFromURL(location.href),
            name: "",
            shopperName: "",
            titleShort: "",
            titleMedium: "",
            titleLong: "",
            header: "",
            quickView: "",
            description: "",
            bulletShort: [],
            bulletLong: [],
            url: location.href
        };

        const fieldMap = {
            "Name": "name",
            "Shopper Name": "shopperName",
            "Title Short": "titleShort",
            "Title Medium": "titleMedium",
            "Title Long": "titleLong",
            "Header": "header",
            "Quick View": "quickView",
            "Description": "description",
            "Bullet Short": "bulletShort",
            "Bullet Long": "bulletLong"
        };

        let any = false;
        for (const label of FIELDS) {
            const nodes = labels[label] || [];
            if (!nodes.length) continue;

            const values = extractFromBlock(nodes[0]);
            const key = fieldMap[label];

            if (Array.isArray(out[key])) out[key] = values; else out[key] = values.find(Boolean) || "";

            any = true;
        }
        return any ? out : null;
    }

    function collectBasics() {
        const root = findSectionRootByTitle("Basics");
        const labels = findLabelNodes(root, ["Age", "Pieces", "Piece barcode"]);
        const valuesByKey = {};

        for (const label of ["Age", "Pieces", "Piece barcode"]) {
            const nodes = labels[label] || [];
            if (!nodes.length) continue;
            const vals = extractFromBlock(nodes[0]);
            if (vals.length) valuesByKey[label] = vals[0];
        }

        const basics = {};
        if (valuesByKey["Age"]) basics.age = String(valuesByKey["Age"]).trim();
        if (valuesByKey["Pieces"]) basics.pieces = String(valuesByKey["Pieces"]).trim();
        if (valuesByKey["Piece barcode"]) {
            const digits = String(valuesByKey["Piece barcode"]).replace(/\D+/g, "");
            if (digits) basics.pieceBarcode = digits;
        }
        return (basics.age || basics.pieces || basics.pieceBarcode) ? basics : null;
    }

    function collectDimensionsB() {
        const norm2 = (s) => (s || "").replace(/\s+/g, " ").trim();
        const key = (s) => norm2(s).toLowerCase();
        const compact = (s) => key(s).replace(/[^a-z0-9]/g, "");

        const heading = Array.from(document.querySelectorAll("p,h1,h2,h3,h4,h5")).find(el => /^dimensions?$/.test(key(el.textContent)));

        const container = heading?.closest('div[class*="chakra-stack"]') || heading?.parentElement || document.body;
        const table = container?.querySelector("table");
        if (!table) return null;

        let headerCells = Array.from(table.querySelectorAll("thead th"));
        if (!headerCells.length) {
            const firstRow = table.querySelector("tbody tr") || table.querySelector("tr");
            headerCells = firstRow ? Array.from(firstRow.querySelectorAll("th,td")) : [];
        }

        const headers = headerCells.map(th => compact(th.textContent));

        const wants = {
            "b/s/t": "bst",
            "alt uom": "altuom",
            "qty": "qty",
            "qty in bu": "qtyinbu",
            "length": "length",
            "width": "width",
            "height": "height",
            "dim unit": "dimunit",
            "volume": "volume",
            "volume unit": "volumeunit",
            "net weight": "netweight",
            "gross weight": "grossweight",
            "tare weight": "tareweight",
            "weight unit": "weightunit"
        };

        const idx = {};
        for (const [label, wantKey] of Object.entries(wants)) {
            idx[label] = headers.findIndex(h => h.includes(wantKey));
        }

        const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
        const rows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll("tr")).slice(1);

        const get = (row, i) => {
            if (i < 0) return "";
            const cells = row.querySelectorAll("td,th");
            return i < cells.length ? norm2(cells[i].textContent) : "";
        };

        const iBST = idx["b/s/t"];
        const rowB = rows.find(tr => compact(get(tr, iBST)) === "b");
        if (!rowB) return null;

        const out = {
            dimB_altUoM: get(rowB, idx["alt uom"]),
            dimB_qty: get(rowB, idx["qty"]),
            dimB_qtyInBU: get(rowB, idx["qty in bu"]),
            dimB_length: get(rowB, idx["length"]),
            dimB_width: get(rowB, idx["width"]),
            dimB_height: get(rowB, idx["height"]),
            dimB_dimUnit: get(rowB, idx["dim unit"]),
            dimB_volume: get(rowB, idx["volume"]),
            dimB_volumeUnit: get(rowB, idx["volume unit"]),
            dimB_netWeight: get(rowB, idx["net weight"]),
            dimB_grossWeight: get(rowB, idx["gross weight"]),
            dimB_tareWeight: get(rowB, idx["tare weight"]),
            dimB_weightUnit: get(rowB, idx["weight unit"])
        };
        return Object.values(out).some(Boolean) ? out : null;
    }

    function isAssetsPage() {
        return /\/products\/[^/]+\/29\/assets\/?$/.test(location.pathname);
    }

    function onAssetsPageNow() {
        return isAssetsPage();
    }

    let activeDownloadController = null;

    function makeAbortError() {
        try {
            return new DOMException("Operation cancelled", "AbortError");
        } catch {
            const error = new Error("Operation cancelled");
            error.name = "AbortError";
            return error;
        }
    }

    function isAbortError(error) {
        return error?.name === "AbortError";
    }

    function throwIfAborted(signal) {
        if (signal?.aborted) throw makeAbortError();
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

    function cancelActiveDownloads() {
        const controller = activeDownloadController;
        if (!controller || controller.signal.aborted) return false;
        controller.abort();
        return true;
    }

    function isVisible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    async function clickElement(el, signal = null) {
        throwIfAborted(signal);
        if (!el) return false;
        el.scrollIntoView({block: "center", inline: "center"});
        await sleep(120, signal);
        throwIfAborted(signal);
        // Try to dispatch a real MouseEvent to better simulate a user click
        try {
            const eventOpts = {
                bubbles: true, cancelable: true, view: window, detail: 1, button: 0, buttons: 1, composed: true
            };
            const down = new MouseEvent("mousedown", eventOpts);
            const up = new MouseEvent("mouseup", eventOpts);
            const click = new MouseEvent("click", eventOpts);
            el.dispatchEvent(down);
            el.dispatchEvent(up);
            el.dispatchEvent(click);
        } catch (e) {
            // fallback
            el.click();
        }
        return true;
    }

    function findAssetCardRootFromNode(node) {
        let el = node;
        for (let i = 0; i < 10 && el; i++) {
            el = el.parentElement;
            if (!el) break;

            const hasLabel = Array.from(el.querySelectorAll?.("p") || []).some(p => ASSET_LABELS.some(lbl => keyNorm(lbl) === keyNorm(p.textContent)));
            const hasDownload = !!el.querySelector?.('button[aria-label="download"]');

            if (hasLabel && hasDownload) return el;
        }
        return node.closest("div") || document.body;
    }

    function findAssetDownloadButton(cardRoot) {
        if (!cardRoot) return null;

        return Array.from(cardRoot.querySelectorAll('button[aria-label="download"], button[title="Download"], button.chakra-button'))
            .find(btn => {
                const aria = keyNorm(btn.getAttribute("aria-label") || "");
                const title = keyNorm(btn.getAttribute("title") || "");
                const text = keyNorm(btn.textContent || "");
                return aria === "download" || title === "download" || text === "download";
            }) || null;
    }

    function collectAssetCards() {
        if (!isAssetsPage()) return null;

        const wanted = new Set(ASSET_LABELS.map(keyNorm));
        const byLabel = new Map();

        const labelNodes = Array.from(document.querySelectorAll("p")).filter(p => wanted.has(keyNorm(p.textContent)));

        for (const labelP of labelNodes) {
            const rawLabel = norm(labelP.textContent);
            if (!rawLabel) continue;

            const canonicalLabel = ASSET_LABELS.find(l => keyNorm(l) === keyNorm(rawLabel)) || rawLabel;

            const root = findAssetCardRootFromNode(labelP);
            const downloadBtn = findAssetDownloadButton(root);
            if (!downloadBtn) continue;

            if (!byLabel.has(canonicalLabel)) {
                byLabel.set(canonicalLabel, {
                    label: canonicalLabel, root, downloadBtn
                });
            }
        }
        return Array.from(byLabel.values());
    }

    function findConfidentialModal() {
        return Array.from(document.querySelectorAll(".chakra-modal__content, section[role='dialog'], [role='dialog']")).find(el => /download of confidential content/i.test(el.textContent || "")) || null;
    }

    function findAcceptAndDownloadButton(modal) {
        if (!modal) return null;
        return Array.from(modal.querySelectorAll("button")).find(btn => {
            const text = norm(btn.textContent).toLowerCase().replace(/\s+/g, " ");
            const title = norm(btn.getAttribute("title")).toLowerCase().replace(/\s+/g, " ");
            return text === "accept & download" || title === "accept & download";
        }) || null;
    }

    function getPopoverTrigger(downloadBtn) {
        if (!downloadBtn) return null;
        return downloadBtn.closest('[aria-haspopup="dialog"][aria-controls], [id^="popover-trigger-"]');
    }

    function getControlledPopoverId(downloadBtn) {
        const trigger = getPopoverTrigger(downloadBtn);
        return trigger?.getAttribute("aria-controls") || "";
    }

    function isDimensionsPopover(popover) {
        return !!popover && /dimensions\s*\(width\s*x\s*height\)|dimensions/i.test(popover.textContent || "");
    }

    function findSizePopover(controlledId = "") {
        if (controlledId) {
            // A popup-enabled download button explicitly identifies its own
            // popover through aria-controls. Never fall back to another open
            // popover, because that can click the previous image's Download.
            const controlled = document.getElementById(controlledId);
            return isDimensionsPopover(controlled) ? controlled : null;
        }

        return Array.from(document.querySelectorAll('.chakra-popover__content[role="dialog"], .chakra-popover__content'))
            .find(el => isDimensionsPopover(el) && isVisible(el)) || null;
    }

    function findPopoverCloseButton(popover) {
        if (!popover) return null;
        return Array.from(popover.querySelectorAll('button[aria-label], button'))
            .find(btn => keyNorm(btn.getAttribute("aria-label") || "") === "close") || null;
    }

    async function closeSizePopover(popover, signal = null, timeoutMs = 2000) {
        throwIfAborted(signal);
        if (!popover || !document.contains(popover) || !isVisible(popover)) return true;

        const closeBtn = findPopoverCloseButton(popover);
        if (closeBtn) {
            await clickElement(closeBtn, signal);
        } else {
            // Chakra popovers normally expose the aria-label=Close button.
            // Escape is only a defensive fallback if the markup changes.
            document.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true
            }));
        }

        return await waitUntilClosed(popover, timeoutMs, signal);
    }

    async function closeVisibleSizePopovers(signal = null) {
        throwIfAborted(signal);
        const visible = Array.from(document.querySelectorAll('.chakra-popover__content[role="dialog"], .chakra-popover__content'))
            .filter(el => isDimensionsPopover(el) && isVisible(el));

        for (const popover of visible) {
            if (!await closeSizePopover(popover, signal)) return false;
        }
        return true;
    }

    function findPopoverDownloadButton(popover) {
        if (!popover) return null;

        // The icon-only trigger also has aria-label="download", so only search
        // inside the opened popover and prefer the footer action with text.
        return Array.from(popover.querySelectorAll("button")).find(btn => {
            const text = norm(btn.textContent).toLowerCase().replace(/\s+/g, " ");
            const title = norm(btn.getAttribute("title")).toLowerCase().replace(/\s+/g, " ");
            const aria = norm(btn.getAttribute("aria-label")).toLowerCase().replace(/\s+/g, " ");
            return text === "download" || title === "download" || aria === "download";
        }) || null;
    }

    function findContextMenuDownloadButton() {
        // Loose fallback in case LEGO uses menu/listbox instead of the dimensions popover.
        return Array.from(document.querySelectorAll('[role="menu"] button, [role="menuitem"], [role="listbox"] button'))
            .find(btn => {
                const text = norm(btn.textContent).toLowerCase().replace(/\s+/g, " ");
                const title = norm(btn.getAttribute("title")).toLowerCase().replace(/\s+/g, " ");
                return text === "download" || title === "download";
            }) || null;
    }

    async function waitForFlowAppearance({
                                             controlledPopoverId = "",
                                             popupExpected = false,
                                             timeoutMs = 5000,
                                             directGraceMs = 700,
                                             signal = null
                                         } = {}) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            throwIfAborted(signal);
            if (!onAssetsPageNow()) {
                return {type: "navigated-away"};
            }

            const modal = findConfidentialModal();
            if (modal && isVisible(modal)) {
                return {type: "confidential-modal", element: modal};
            }

            const popover = findSizePopover(controlledPopoverId);
            if (popover && isVisible(popover)) {
                return {type: "size-popover", element: popover};
            }

            const menuBtn = findContextMenuDownloadButton();
            if (menuBtn && isVisible(menuBtn)) {
                return {type: "context-download", element: menuBtn};
            }

            // A plain button (no aria-haspopup/aria-controls wrapper) downloads
            // immediately. Do not make every direct image wait five seconds.
            if (!popupExpected && Date.now() - start >= directGraceMs) {
                return {type: "direct-download"};
            }

            await sleep(100, signal);
        }

        // When the DOM explicitly says this is a popover trigger, timing out is
        // an error rather than silently assuming a direct download happened.
        return popupExpected ? {type: "popover-not-opened"} : {type: "direct-download"};
    }

    async function acceptConfidentialDownload(modal, signal = null) {
        throwIfAborted(signal);
        const acceptBtn = findAcceptAndDownloadButton(modal);
        if (!acceptBtn) {
            return {ok: false, reason: "accept-download-button-not-found"};
        }

        await clickElement(acceptBtn, signal);
        await waitUntilClosed(modal, 5000, signal);
        await sleep(1200, signal);

        if (!onAssetsPageNow()) {
            return {ok: false, reason: "navigated-away-after-confidential-accept"};
        }
        return {ok: true};
    }

    async function waitForConfidentialAfterAction(timeoutMs = 1500, signal = null) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            throwIfAborted(signal);
            const modal = findConfidentialModal();
            if (modal && isVisible(modal)) return modal;
            if (!onAssetsPageNow()) return null;
            await sleep(100, signal);
        }
        return null;
    }

    async function waitUntilClosed(target, timeoutMs = 5000, signal = null) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            throwIfAborted(signal);
            if (!target || !document.contains(target) || !isVisible(target)) {
                return true;
            }
            if (!onAssetsPageNow()) {
                return false;
            }
            await sleep(150, signal);
        }
        return false;
    }

    async function handleSingleDownloadFlow(card, signal = null) {
        throwIfAborted(signal);
        if (!onAssetsPageNow()) {
            return {ok: false, reason: "left-assets-page-before-click"};
        }

        // A dimensions popup can remain mounted and visible after its Download
        // action. Close every stale popup before resolving/clicking the next card.
        // If cleanup fails, stop rather than risk downloading the old image again.
        if (!await closeVisibleSizePopovers(signal)) {
            return {ok: false, fatal: true, reason: "stale-size-popover-could-not-close"};
        }

        const cachedBtn = card.downloadBtn;
        const btn = cachedBtn?.isConnected ? cachedBtn : findAssetDownloadButton(card.root);
        if (!btn) {
            return {ok: false, reason: "download-button-not-found"};
        }

        const controlledPopoverId = getControlledPopoverId(btn);
        const popupExpected = !!getPopoverTrigger(btn);

        await clickElement(btn, signal);

        const flow = await waitForFlowAppearance({
            controlledPopoverId, popupExpected, timeoutMs: popupExpected ? 5000 : 1400, directGraceMs: 700, signal
        });

        if (flow.type === "navigated-away") {
            return {ok: false, reason: "navigated-away-after-first-click"};
        }

        if (flow.type === "popover-not-opened") {
            return {ok: false, reason: "size-popover-not-opened"};
        }

        if (flow.type === "confidential-modal") {
            const accepted = await acceptConfidentialDownload(flow.element, signal);
            return accepted.ok ? {ok: true, via: "confidential-modal"} : accepted;
        }

        if (flow.type === "size-popover") {
            const popBtn = findPopoverDownloadButton(flow.element);
            if (!popBtn) {
                return {ok: false, reason: "popover-download-button-not-found"};
            }

            await clickElement(popBtn, signal);

            // The site does not consistently dismiss this widget after its
            // Download action. Explicitly press its aria-label=Close button so
            // the next card cannot reuse this popup and download the old image.
            await sleep(150, signal);
            const popoverClosed = await closeSizePopover(flow.element, signal);
            if (!popoverClosed) {
                return {ok: false, fatal: true, reason: "size-popover-could-not-close-after-download"};
            }

            // Some assets can chain the dimensions popover into the existing
            // confidential-content confirmation dialog.
            const chainedModal = await waitForConfidentialAfterAction(1500, signal);
            if (chainedModal) {
                const accepted = await acceptConfidentialDownload(chainedModal, signal);
                return accepted.ok ? {ok: true, via: "size-popover+confidential-modal"} : accepted;
            }

            await sleep(1200, signal);

            if (!onAssetsPageNow()) {
                return {ok: false, reason: "navigated-away-after-size-popover"};
            }
            return {ok: true, via: "size-popover"};
        }

        if (flow.type === "context-download") {
            await clickElement(flow.element, signal);

            const chainedModal = await waitForConfidentialAfterAction(1500, signal);
            if (chainedModal) {
                const accepted = await acceptConfidentialDownload(chainedModal, signal);
                return accepted.ok ? {ok: true, via: "context-menu+confidential-modal"} : accepted;
            }

            await sleep(1200, signal);

            if (!onAssetsPageNow()) {
                return {ok: false, reason: "navigated-away-after-context-download"};
            }
            return {ok: true, via: "context-menu"};
        }

        // Plain button path: the first click already started the download.
        await sleep(1200, signal);

        if (!onAssetsPageNow()) {
            return {ok: false, reason: "navigated-away-after-direct-click"};
        }
        return {ok: true, via: "direct-download"};
    }

    async function downloadAllAssets() {
        if (!isAssetsPage()) {
            return {ok: false, error: "not-assets-page", downloaded: [], failed: []};
        }

        // Only one asset run may be active. Starting a new one cancels any stale run.
        cancelActiveDownloads();
        const controller = new AbortController();
        activeDownloadController = controller;
        const {signal} = controller;

        const cards = collectAssetCards() || [];
        const downloaded = [];
        const failed = [];

        try {
            for (const card of cards) {
                throwIfAborted(signal);

                try {
                    const result = await handleSingleDownloadFlow(card, signal);

                    if (result.ok) {
                        downloaded.push({label: card.label, via: result.via});
                    } else {
                        failed.push({label: card.label, reason: result.reason || "download-failed"});

                        // Popup cleanup failures are fatal: continuing could click
                        // a stale popup and download the previous image again.
                        if (result.fatal || !onAssetsPageNow()) break;
                    }

                    // Abortable gap before the next asset so flows do not overlap.
                    await sleep(900, signal);
                } catch (error) {
                    if (isAbortError(error)) throw error;

                    failed.push({label: card.label, reason: String(error)});
                    if (!onAssetsPageNow()) break;
                    await sleep(900, signal);
                }
            }

            return {
                ok: true,
                productId: extractProductIdFromURL(location.href),
                url: location.href,
                found: cards.length,
                downloaded,
                failed
            };
        } catch (error) {
            if (!isAbortError(error)) throw error;

            return {
                ok: false,
                stopped: true,
                error: "cancelled",
                productId: extractProductIdFromURL(location.href),
                url: location.href,
                found: cards.length,
                downloaded,
                failed
            };
        } finally {
            if (activeDownloadController === controller) {
                activeDownloadController = null;
            }
        }
    }


    function getAssetPlan() {
        if (!isAssetsPage()) return [];
        return (collectAssetCards() || []).map((card, index) => ({
            index, label: card.label
        }));
    }

    async function downloadSingleAsset(requestedLabel) {
        if (!isAssetsPage()) {
            return {ok: false, error: "not-assets-page", label: requestedLabel || ""};
        }

        // Each popup-side request owns one abort controller. This lets Stop
        // interrupt the currently active image without losing the outer plan.
        cancelActiveDownloads();
        const controller = new AbortController();
        activeDownloadController = controller;
        const {signal} = controller;

        const cards = collectAssetCards() || [];
        const wanted = keyNorm(requestedLabel || "");
        const card = cards.find(item => keyNorm(item.label) === wanted);

        if (!card) {
            if (activeDownloadController === controller) activeDownloadController = null;
            return {
                ok: false, label: requestedLabel || "", reason: "asset-card-not-found", found: cards.length
            };
        }

        try {
            const result = await handleSingleDownloadFlow(card, signal);
            return Object.assign({label: card.label, found: cards.length}, result);
        } catch (error) {
            if (!isAbortError(error)) throw error;
            return {
                ok: false, stopped: true, error: "cancelled", label: card.label, found: cards.length
            };
        } finally {
            if (activeDownloadController === controller) {
                activeDownloadController = null;
            }
        }
    }

    function collect() {
        const text = collectText();
        const basics = collectBasics();
        const dimsB = collectDimensionsB();

        const base = text || {
            productId: extractProductIdFromURL(location.href), url: location.href
        };
        return Object.assign({}, base, basics || {}, dimsB || {});
    }

    function ready() {
        if (isAssetsPage()) {
            const cards = collectAssetCards() || [];
            return {found: cards.length, valued: cards.length};
        }

        const root = findSectionRootByTitle("Basics");
        const labelsText = findLabelNodes(root, FIELDS);
        const labelsBasics = findLabelNodes(root, BASICS_FIELDS);

        let found = 0;
        let valued = 0;

        const count = (labels, pool) => {
            for (const label of pool) {
                const nodes = labels[label] || [];
                if (nodes.length) {
                    found++;
                    const vals = extractFromBlock(nodes[0]);
                    if (vals.some(Boolean)) valued++;
                }
            }
        };

        count(labelsText, FIELDS);
        count(labelsBasics, BASICS_FIELDS);

        if (collectDimensionsB()) {
            found++;
            valued++;
        }
        return {found, valued};
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (message?.type !== "DORMANT_CANCEL_DOWNLOADS") return;

        sendResponse({ok: true, cancelled: cancelActiveDownloads()});
        return false;
    });

    window.__DormantScraper__ = Object.freeze({
        assetPlan: () => getAssetPlan(),
        downloadAsset: (label) => downloadSingleAsset(label),
        downloadAssets: () => downloadAllAssets(),
        cancelDownloads: () => cancelActiveDownloads(),
        run: () => {
            forceStandardTabNow();
            return collect();
        },
        toJSON: () => {
            forceStandardTabNow();
            return JSON.stringify(collect(), null, 2);
        },
        copy: async () => {
            forceStandardTabNow();
            const json = JSON.stringify(collect(), null, 2);
            try {
                await navigator.clipboard.writeText(json);
            } catch {
            }
            return json;
        },
        log: () => {
            forceStandardTabNow();
            console.log(collect());
        },
        ready: () => ready(),
        isReady: (minValued = 2) => {
            try {
                const {valued} = ready();
                return valued >= (Number(minValued) || 2);
            } catch {
                return false;
            }
        }
    });
})();