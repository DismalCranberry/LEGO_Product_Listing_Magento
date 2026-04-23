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

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function isVisible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    async function clickElement(el) {
        if (!el) return false;
        el.scrollIntoView({block: "center", inline: "center"});
        await sleep(120);
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

    function findSizePopover() {
        return Array.from(document.querySelectorAll(".chakra-popover__content")).find(el => /dimensions/i.test(el.textContent || "")) || null;
    }

    function findPopoverDownloadButton(popover) {
        if (!popover) return null;
        return Array.from(popover.querySelectorAll("button")).find(btn => {
            const text = norm(btn.textContent).toLowerCase().replace(/\s+/g, " ");
            const title = norm(btn.getAttribute("title")).toLowerCase().replace(/\s+/g, " ");
            const aria = norm(btn.getAttribute("aria-label")).toLowerCase().replace(/\s+/g, " ");
            return text === "download" || title === "download" || aria === "download";
        }) || null;
    }

    function findContextMenuDownloadButton() {
        // Loose fallback in case LEGO uses menu/listbox instead of popover text flow
        return Array.from(document.querySelectorAll('[role="menu"] button, [role="menuitem"], [role="listbox"] button, [role="dialog"] button'))
            .find(btn => {
                const text = norm(btn.textContent).toLowerCase().replace(/\s+/g, " ");
                const title = norm(btn.getAttribute("title")).toLowerCase().replace(/\s+/g, " ");
                return text === "download" || title === "download";
            }) || null;
    }

    async function waitForFlowAppearance(timeoutMs = 5000) {
        const start = Date.now();

        while (Date.now() - start < timeoutMs) {
            if (!onAssetsPageNow()) {
                return {type: "navigated-away"};
            }

            const modal = findConfidentialModal();
            if (modal && isVisible(modal)) {
                return {type: "confidential-modal", element: modal};
            }

            const popover = findSizePopover();
            if (popover && isVisible(popover)) {
                return {type: "size-popover", element: popover};
            }

            const menuBtn = findContextMenuDownloadButton();
            if (menuBtn && isVisible(menuBtn)) {
                return {type: "context-download", element: menuBtn};
            }
            await sleep(150);
        }
        return {type: "direct-download"};
    }

    async function waitUntilClosed(target, timeoutMs = 5000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (!target || !document.contains(target) || !isVisible(target)) {
                return true;
            }
            if (!onAssetsPageNow()) {
                return false;
            }
            await sleep(150);
        }
        return false;
    }

    async function handleSingleDownloadFlow(card) {
        if (!onAssetsPageNow()) {
            return {ok: false, reason: "left-assets-page-before-click"};
        }

        const btn = card.downloadBtn || findAssetDownloadButton(card.root);
        if (!btn) {
            return {ok: false, reason: "download-button-not-found"};
        }

        await clickElement(btn);

        const flow = await waitForFlowAppearance(5000);

        if (flow.type === "navigated-away") {
            return {ok: false, reason: "navigated-away-after-first-click"};
        }

        if (flow.type === "confidential-modal") {
            const acceptBtn = findAcceptAndDownloadButton(flow.element);
            if (!acceptBtn) {
                return {ok: false, reason: "accept-download-button-not-found"};
            }

            await clickElement(acceptBtn);

            // Wait for modal to close or just cooldown if it remains mounted invisibly
            await waitUntilClosed(flow.element, 5000);
            await sleep(1200);

            if (!onAssetsPageNow()) {
                return {ok: false, reason: "navigated-away-after-confidential-accept"};
            }
            return {ok: true, via: "confidential-modal"};
        }

        if (flow.type === "size-popover") {
            const popBtn = findPopoverDownloadButton(flow.element);
            if (!popBtn) {
                return {ok: false, reason: "popover-download-button-not-found"};
            }

            await clickElement(popBtn);
            await waitUntilClosed(flow.element, 5000);
            await sleep(1200);

            if (!onAssetsPageNow()) {
                return {ok: false, reason: "navigated-away-after-size-popover"};
            }
            return {ok: true, via: "size-popover"};
        }

        if (flow.type === "context-download") {
            await clickElement(flow.element);
            await sleep(1200);

            if (!onAssetsPageNow()) {
                return {ok: false, reason: "navigated-away-after-context-download"};
            }
            return {ok: true, via: "context-menu"};
        }

        // direct download path: no extra UI appeared
        await sleep(1200);

        if (!onAssetsPageNow()) {
            return {ok: false, reason: "navigated-away-after-direct-click"};
        }
        return {ok: true, via: "direct-download"};
    }

    async function downloadAllAssets() {
        if (!isAssetsPage()) {
            return {ok: false, error: "not-assets-page", downloaded: [], failed: []};
        }

        const cards = collectAssetCards() || [];
        const downloaded = [];
        const failed = [];

        for (const card of cards) {
            try {
                const result = await handleSingleDownloadFlow(card);

                if (result.ok) {
                    downloaded.push({label: card.label, via: result.via});
                } else {
                    failed.push({label: card.label, reason: result.reason || "download-failed"});

                    // If we left the assets page, stop immediately.
                    if (!onAssetsPageNow()) break;
                }

                // Small gap before the next asset so flows do not overlap
                await sleep(900);
            } catch (e) {
                failed.push({label: card.label, reason: String(e)});
                if (!onAssetsPageNow()) break;
                await sleep(900);
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

    window.__DormantScraper__ = Object.freeze({
        downloadAssets: () => downloadAllAssets(), run: () => {
            forceStandardTabNow();
            return collect();
        }, toJSON: () => {
            forceStandardTabNow();
            return JSON.stringify(collect(), null, 2);
        }, copy: async () => {
            forceStandardTabNow();
            const json = JSON.stringify(collect(), null, 2);
            try {
                await navigator.clipboard.writeText(json);
            } catch {
            }
            return json;
        }, log: () => {
            forceStandardTabNow();
            console.log(collect());
        }, ready: () => ready(), isReady: (minValued = 2) => {
            try {
                const {valued} = ready();
                return valued >= (Number(minValued) || 2);
            } catch {
                return false;
            }
        }
    });
})();