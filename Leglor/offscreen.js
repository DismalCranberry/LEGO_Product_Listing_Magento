// offscreen.js
const FIELDS = ["Name", "Shopper Name", "Title Short", "Title Medium", "Title Long", "Header", "Quick View", "Description", "Bullet Short", "Bullet Long"];

const norm = s => String(s || "").replace(/\s+/g, " ").trim();
const keyNorm = s => norm(s).toLowerCase();

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

function findRoot(doc) {
    const stacks = Array.from(doc.querySelectorAll('div[class*="chakra-stack"]'));
    return stacks.find(el => el.querySelector("p") && FIELDS.some(f => el.textContent?.includes(f))) || doc.body;
}

function findLabelNodes(root) {
    const labels = {};
    const allP = root.querySelectorAll("p");
    for (const p of allP) {
        const t = norm(p.textContent);
        if (!t) continue;
        const k = keyNorm(t);
        for (const want of FIELDS) {
            if (k === keyNorm(want)) (labels[want] ||= []).push(p);
        }
    }
    return labels;
}

function extractFromBlock(doc, labelP) {
    let block = labelP.closest('div[class*="css-hboir"]') || labelP.closest('div[class*="chakra-stack"]') || labelP.parentElement || doc.body;

    const sides = Array.from(block.children);
    const rightSide = sides.length > 1 ? sides[1] : block;

    const valuePs = Array.from(rightSide.querySelectorAll("p"))
        .filter(p => p !== labelP && norm(p.textContent));

    if (valuePs.length === 0) {
        let cursor = labelP.nextElementSibling;
        while (cursor && cursor.tagName !== "P") cursor = cursor.nextElementSibling;
        if (cursor && norm(cursor.textContent)) valuePs.push(cursor);
    }
    return valuePs.map(p => norm(p.textContent));
}

function extractFromHTML(html, url) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const root = findRoot(doc);
    const labels = findLabelNodes(root);

    const out = {
        productId: extractProductIdFromURL(url),
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
        url
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

    for (const label of FIELDS) {
        const nodes = labels[label] || [];
        if (nodes.length === 0) continue;
        const values = extractFromBlock(doc, nodes[0]);
        const key = fieldMap[label];
        if (Array.isArray(out[key])) out[key] = values; else out[key] = values.find(Boolean) || "";
    }
    return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
        if (msg?.type !== "PARSE_HTML") return;
        try {
            const rec = extractFromHTML(msg.html, msg.url);
            sendResponse({ok: true, record: rec});
        } catch (e) {
            sendResponse({ok: false, error: String(e)});
        }
    })();
    return true; // async response
});