// Dormant page scraper. No work until window.__DormantScraper__.run() is called.
(() => {

// --- force "Standard" view on LEGO text pages ---
    function forceStandardView() {
        // only target .../products/{id}/29/text
        const path = location.pathname;
        if (!/\/products\/[^/]+\/29\/text\/?$/.test(path)) return;

        function findButtons() {
            const buttons = Array.from(document.querySelectorAll('button.chakra-button'));
            const standardBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'standard');
            const optimizedBtn = buttons.find(b => b.textContent && b.textContent.trim().toLowerCase() === 'optimized');
            return {standardBtn, optimizedBtn};
        }

        function clickStandardIfPossible() {
            const {standardBtn} = findButtons();
            if (standardBtn) {
                standardBtn.click();
                return true;
            }
            return false;
        }

        // 1) try right away
        clickStandardIfPossible();

        // 2) watch for late-rendered UI
        const mo = new MutationObserver(() => {
            // if we can click it now, great
            if (clickStandardIfPossible()) {
                // don't disconnect yet — we still want to watch for their “switch back”
                // we’ll let the interval below handle timing out
            }
        });
        mo.observe(document.body, {childList: true, subtree: true});

        // 3) be stubborn for a short window (LEGO seems to flip to "Optimized" late)
        const enforceUntil = Date.now() + 8000; // 8 seconds after load
        const interval = setInterval(() => {
            if (Date.now() > enforceUntil) {
                clearInterval(interval);
                mo.disconnect();
                return;
            }
            clickStandardIfPossible();
        }, 400);
    }

// run it as soon as the content script loads
    forceStandardView();

    const FIELDS = ["Name", "Shopper Name", "Title Short", "Title Medium", "Title Long", "Header", "Quick View", "Description", "Bullet Short", "Bullet Long",];

    const BASICS_FIELDS = ["Pieces", "Age", "Product", "Item", "Version", "Piece barcode", "Carton Barcode"];

    // Asset labels shown on /products/{id}/29/assets
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
        // only care about the text pages
        const path = location.pathname;
        if (!/\/products\/[^/]+\/29\/text\/?$/.test(path)) {
            return;
        }

        const buttons = Array.from(document.querySelectorAll('button.chakra-button'));
        const standardBtn = buttons.find((b) => b.textContent && b.textContent.trim().toLowerCase() === 'standard');
        if (standardBtn) {
            standardBtn.click();
        }
    }


    function findRoot() {
        const stacks = Array.from(document.querySelectorAll('div[class*="chakra-stack"]'));
        return (stacks.find(el => el.querySelector("p") && (FIELDS.concat(BASICS_FIELDS, ["Dimension"])).some(f => el.textContent?.includes?.(f))) || document.body);
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
            // Common /data layout: label <p> then value <p>
            valuePs = [rightSide];
        } else {
            valuePs = Array.from(rightSide.querySelectorAll("p"));
        }

        valuePs = valuePs.filter((p) => p !== labelP && norm(p.textContent));

        if (valuePs.length === 0) {
            let cursor = labelP.nextElementSibling;

            // walk to the next element that actually has meaningful text
            while (cursor && !norm(cursor.textContent)) cursor = cursor.nextElementSibling;

            if (cursor) {
                // if it's a wrapper, prefer an inner <p>
                const innerP = cursor.querySelector?.("p");
                const node = innerP || cursor;

                if (norm(node.textContent)) valuePs.push(node);
            }
        }
        return valuePs.map((p) => norm(p.textContent));
    }

    // ---------- TEXT PAGE ----------
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

    // ---------- DATA PAGE: Basics ----------
    function collectBasics() {
        const root = findSectionRootByTitle("Basics");   // <- the key improvement
        const BASICS_FIELDS = ["Age", "Pieces", "Piece barcode"];
        const labels = findLabelNodes(root, BASICS_FIELDS);
        const valuesByKey = {};

        for (const label of BASICS_FIELDS) {
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


// ---------- DATA PAGE: Dimension table (robust "row B" extraction) ----------
    function collectDimensionsB() {
        const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
        const key = (s) => norm(s).toLowerCase();
        const compact = (s) => key(s).replace(/[^a-z0-9]/g, "");

        // 1) Find a heading that looks like "Dimension(s)" and the nearest table
        const heading = Array.from(document.querySelectorAll("p,h1,h2,h3,h4,h5"))
            .find(el => /^dimensions?$/.test(key(el.textContent)));
        const container = heading?.closest('div[class*="chakra-stack"]') || heading?.parentElement || document.body;
        const table = container?.querySelector("table");
        if (!table) return null;

        // 2) Read headers from <thead> OR from the first <tr> if there is no <thead>
        let headerCells = Array.from(table.querySelectorAll("thead th"));
        if (!headerCells.length) {
            const firstRow = table.querySelector("tbody tr") || table.querySelector("tr");
            headerCells = firstRow ? Array.from(firstRow.querySelectorAll("th,td")) : [];
            // If we stole the first body row as headers, advance body rows accordingly
        }
        const headers = headerCells.map(th => compact(th.textContent));

        // Desired columns (use compacted keys for fuzzy match)
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

        // Build an index map by fuzzy “includes” (handles e.g. "Alt UOM", "Qty in BU")
        const idx = {};
        for (const [label, wantKey] of Object.entries(wants)) {
            idx[label] = headers.findIndex(h => h.includes(wantKey));
        }

        // 3) Locate body rows (skip header row if we treated the first row as headers)
        const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
        const rows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll("tr")).slice(1);

        const get = (row, i) => {
            if (i < 0) return "";
            const cells = row.querySelectorAll("td,th");
            return i < cells.length ? norm(cells[i].textContent) : "";
        };

        // 4) Find the row where the first column (B/S/T) is "B"
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

        // Return only if something non-empty was read
        return Object.values(out).some(Boolean) ? out : null;
    }

    // ---------- ASSETS PAGE: image label -> original image URL ----------
    function isAssetsPage() {
        return /\/products\/[^/]+\/29\/assets\/?$/.test(location.pathname);
    }

    function cleanImgUrl(u) {
        const s = String(u || "");
        return s.split("?")[0];
    }

    function aspectScore(img) {
        // Use intrinsic size if available; fall back to layout size.
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        if (!w || !h) return Number.POSITIVE_INFINITY; // deprioritize unloaded/zero-size
        const r = w / h;
        return Math.abs(r - 1); // distance from perfect square
    }

    // Try to find the "card" container that contains both the <img> and its label <p>.
    // We avoid using session-specific CSS class names.
    function findAssetCardRoot(img) {
        let el = img;
        for (let i = 0; i < 8 && el; i++) {
            el = el.parentElement;
            if (!el) break;
            const hasP = el.querySelectorAll && el.querySelectorAll("p").length > 0;
            const hasImg = el.querySelectorAll && el.querySelectorAll("img").length > 0;
            // This heuristic catches the common layout: a wrapper that contains the image and some <p> text.
            if (hasP && hasImg) return el;
        }
        return img.closest("div") || document.body;
    }

    function collectAssets() {
        if (!isAssetsPage()) return null;

        const wanted = new Set(ASSET_LABELS.map(keyNorm));

        // label -> array of <img> candidates
        const buckets = new Map();

        const imgs = Array.from(document.querySelectorAll('img[src*="image.content.lego.com/public/image/"]'));

        for (const img of imgs) {
            const root = findAssetCardRoot(img);
            const ps = Array.from(root.querySelectorAll("p"));
            const labelP = ps.find(p => wanted.has(keyNorm(p.textContent)));
            if (!labelP) continue;

            const rawLabel = norm(labelP.textContent);
            if (!rawLabel) continue;

            const labelKey = keyNorm(rawLabel);
            const canonicalLabel = ASSET_LABELS.find(l => keyNorm(l) === labelKey) || rawLabel;

            if (!buckets.has(canonicalLabel)) {
                buckets.set(canonicalLabel, []);
            }
            buckets.get(canonicalLabel).push(img);
        }
        const out = {};

        // For each label, pick the img closest to 1:1 aspect ratio
        for (const [label, imgsForLabel] of buckets.entries()) {
            if (!imgsForLabel.length) continue;

            let bestImg = imgsForLabel[0];
            let bestScore = aspectScore(bestImg);

            for (let i = 1; i < imgsForLabel.length; i++) {
                const candidate = imgsForLabel[i];
                const score = aspectScore(candidate);
                if (score < bestScore) {
                    bestScore = score;
                    bestImg = candidate;
                }
            }
            const src = bestImg.currentSrc || bestImg.src;
            if (!src) continue;

            out[label] = cleanImgUrl(src);
        }
        return Object.keys(out).length ? out : null;
    }


    function collect() {
        // If we're on /assets, return asset columns directly.
        const assets = collectAssets();
        if (assets) {
            return Object.assign({
                productId: extractProductIdFromURL(location.href), url: location.href
            }, assets);
        }

        const text = collectText();
        const basics = collectBasics();
        const dimsB = collectDimensionsB();

        // Merge whatever we found
        const base = text || {
            productId: extractProductIdFromURL(location.href), url: location.href
        };
        return Object.assign({}, base, basics || {}, dimsB || {});
    }

    // ---- readiness: treat page as "ready" when any labeled block yields values ----
    function ready() {
        // Assets page: ready when we found at least one wanted asset
        if (isAssetsPage()) {
            const assets = collectAssets();
            const n = assets ? Object.keys(assets).length : 0;
            return {found: n, valued: n};
        }

        const root = findSectionRootByTitle("Basics");
        const labelsText = findLabelNodes(root, FIELDS);
        const labelsBasics = findLabelNodes(root, BASICS_FIELDS);

        let found = 0, valued = 0;
        const count = (labels, pool) => {
            for (const label of pool) {
                const nodes = labels[label] || [];
                if (nodes.length) {
                    found++;
                    const vals = nodes.length ? extractFromBlock(nodes[0]) : [];
                    if (vals.some(Boolean)) valued++;
                }
            }
        };
        count(labelsText, FIELDS);
        count(labelsBasics, BASICS_FIELDS);

        // Dimension table: count as 1 valued block if row B exists with some value
        if (collectDimensionsB()) {
            found++;
            valued++;
        }

        return {found, valued};
    }

    function findSectionRootByTitle(title) {
        const wanted = keyNorm(title);
        const heading = Array.from(document.querySelectorAll("p,h1,h2,h3,h4,h5"))
            .find(el => keyNorm(el.textContent) === wanted);

        // In your HTML, "Basics" is inside a wrapper like <div class="css-1bqan07">...</div>
        return heading?.closest('div[class*="css-1bqan07"]') || heading?.closest('div[class*="chakra-stack"]') || heading?.parentElement || document.body;
    }

    window.__DormantScraper__ = Object.freeze({
        run: () => {
            // make sure we’re on the Standard tab *right now*
            forceStandardTabNow();
            // now read the DOM
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