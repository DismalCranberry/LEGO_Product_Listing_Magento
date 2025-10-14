// Dormant page scraper. No work until window.__DormantScraper__.run() is called.
(() => {
  const FIELDS = [
    "Name","Shopper Name","Title Short","Title Medium","Title Long",
    "Header","Quick View","Description","Bullet Short","Bullet Long",
  ];

  const BASICS_FIELDS = ["Pieces","Age","Product","Item","Version","Piece barcode","Carton Barcode"];

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const keyNorm = (s) => norm(s).toLowerCase();

  function extractProductIdFromURL(u) {
    try {
      const url = new URL(u);
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("products");
      if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
    } catch {}
    return "";
  }

  function findRoot() {
    const stacks = Array.from(document.querySelectorAll('div[class*="chakra-stack"]'));
    return (
      stacks.find(el => el.querySelector("p") && (FIELDS.concat(BASICS_FIELDS, ["Dimension"])).some(f => el.textContent?.includes?.(f)))
      || document.body
    );
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
    let block =
      labelP.closest('div[class*="css-hboir"]') ||
      labelP.closest('div[class*="chakra-stack"]') ||
      labelP.parentElement ||
      document.body;

    const sides = Array.from(block.children);
    const rightSide = sides.length > 1 ? sides[1] : block;

    const valuePs = Array.from(rightSide.querySelectorAll("p")).filter(
      (p) => p !== labelP && norm(p.textContent)
    );

    if (valuePs.length === 0) {
      let cursor = labelP.nextElementSibling;
      while (cursor && cursor.tagName !== "P") cursor = cursor.nextElementSibling;
      if (cursor && norm(cursor.textContent)) valuePs.push(cursor);
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
      if (Array.isArray(out[key])) out[key] = values;
      else out[key] = values.find(Boolean) || "";
      any = true;
    }
    return any ? out : null;
  }

  // ---------- DATA PAGE: Basics ----------
  function collectBasics() {
    const root = findRoot();
    const labels = findLabelNodes(root, BASICS_FIELDS);

    const valuesByKey = {};
    for (const label of BASICS_FIELDS) {
      const nodes = labels[label] || [];
      if (!nodes.length) continue;
      const vals = extractFromBlock(nodes[0]);
      if (vals.length) valuesByKey[label] = vals[0];
    }

    const basics = {};
    if (valuesByKey["Age"])    basics.age = valuesByKey["Age"];         // e.g. "18+"
    if (valuesByKey["Pieces"]) basics.pieces = valuesByKey["Pieces"];   // e.g. "789"
    return (basics.age || basics.pieces) ? basics : null;
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
    dimB_altUoM:      get(rowB, idx["alt uom"]),
    dimB_qty:         get(rowB, idx["qty"]),
    dimB_qtyInBU:     get(rowB, idx["qty in bu"]),
    dimB_length:      get(rowB, idx["length"]),
    dimB_width:       get(rowB, idx["width"]),
    dimB_height:      get(rowB, idx["height"]),
    dimB_dimUnit:     get(rowB, idx["dim unit"]),
    dimB_volume:      get(rowB, idx["volume"]),
    dimB_volumeUnit:  get(rowB, idx["volume unit"]),
    dimB_netWeight:   get(rowB, idx["net weight"]),
    dimB_grossWeight: get(rowB, idx["gross weight"]),
    dimB_tareWeight:  get(rowB, idx["tare weight"]),
    dimB_weightUnit:  get(rowB, idx["weight unit"])
  };

  // Return only if something non-empty was read
  return Object.values(out).some(Boolean) ? out : null;
}

  function collect() {
    const text = collectText();
    const basics = collectBasics();
    const dimsB = collectDimensionsB();

    // Merge whatever we found
    const base = text || {
      productId: extractProductIdFromURL(location.href),
      url: location.href
    };
    return Object.assign({}, base, basics || {}, dimsB || {});
  }

  // ---- readiness: treat page as "ready" when any labeled block yields values ----
  function ready() {
    const root = findRoot();
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
    if (collectDimensionsB()) { found++; valued++; }

    return { found, valued };
  }

  window.__DormantScraper__ = Object.freeze({
    run: () => collect(),
    toJSON: () => JSON.stringify(collect(), null, 2),
    copy: async () => {
      const json = JSON.stringify(collect(), null, 2);
      try { await navigator.clipboard.writeText(json); } catch {}
      return json;
    },
    log: () => console.log(collect()),
    ready: () => ready(),
    isReady: (minValued = 2) => {
      try {
        const { valued } = ready();
        return valued >= (Number(minValued) || 2);
      } catch { return false; }
    }
  });
})();
