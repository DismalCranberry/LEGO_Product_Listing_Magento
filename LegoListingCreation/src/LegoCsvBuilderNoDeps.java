import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class LegoCsvBuilderNoDeps {

    private static final String MAGENTO_IMPORT_FILE = "res/magento_import.csv";
    private static final String LEGO_SCRAPE_FILE = "res/lego-scrape.csv";
    private static final String OUTPUT_MAIN_FILE = "results/LEGO_FOR_IMPORT.csv";
    private static final String OUTPUT_SECOND_FILE = "results/LEGO_SASHO.csv";

    private static final int IDX_B = 1; // Bulletpoints
    private static final int IDX_C = 2; // Description
    private static final int IDX_E = 4; // Alternative name
    private static final int IDX_F = 5; // Lego code
    private static final int IDX_H = 7; // Name
    private static final int IDX_M = 12; // Age
    private static final int IDX_O = 14; // Barcode
    private static final int IDX_S = 18; // Length
    private static final int IDX_T = 19; // Width
    private static final int IDX_U = 20; // Height
    private static final int IDX_Y = 24; // Weight
    private static final int IDX_AC = 28; // Main V29
    private static final int IDX_AD = 29; // Box & Product V29
    private static final int IDX_AE = 30; // Build
    private static final int IDX_AF = 31; // Consumer
    private static final int IDX_AG = 32; // Environment
    private static final int IDX_AH = 33; // Product
    private static final int IDX_AI = 34; // Secondary 01 (No BG)
    private static final int IDX_AJ = 35; // Secondary 02 (No BG)

    // Fixed values
    private static final String CATEGORIES = "Default Category/Меню продукти/Детски играчки/LEGO," + "Default Category," + "Default Category/Меню продукти," + "Default Category/Меню продукти/Детски играчки," + "Default Category/Ново," + "Default Category/Ново/Детски играчки - Ново," + "Default Category/Меню продукти/Детски играчки/Конструктори и мозайки," + "Default Category/Меню продукти/Детски играчки/Конструктори и мозайки/Конструктори";
    private static final String MANUFACTURER = "LEGO";
    private static final String RESPONSIBLE_ENTITY_NAME = "LEGO System A/S";
    private static final String RESPONSIBLE_ENTITY_ADDRESS = "Dinu Vintila Street 11 9th Fl 021101 Bucharest";
    private static final String RESPONSIBLE_ENTITY_CONTACT = "lucretiu.dumitrescu@lego.com";
    private static final String STORE_ID = "base,fluxstore_website";
    private static final DateTimeFormatter DATE_FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final String PRICE = "9999";
    private static final String PRODUCT_ONLINE = "0";
    private static final String PRODUCT_TYPE = "simple";
    private static final String ATTRIBUTE_SET_CODE = "Default";
    private static final String VISIBILITY = "Catalog, Search";
    private static final String SEX = "За момчета,За момичета";

    // Series list
    private static final String[] SERIES_LIST = new String[]{"LEGO Classic", "LEGO Architecture", "LEGO Creator", "LEGO City", "LEGO Super Heroes", "LEGO Boost", "LEGO Star Wars", "LEGO Duplo", "LEGO Friends", "LEGO Technic", "LEGO Minecraft", "LEGO Ninjago", "LEGO Juniors", "LEGO Speed Champions", "LEGO Overwatch", "LEGO The Movie", "LEGO Toy Story 4", "LEGO Spiderman", "LEGO Batman", "LEGO Jurassic World", "LEGO Hidden Side™", "LEGO Disney", "LEGO Disney Princess", "LEGO DOTS", "LEGO Trolls", "LEGO Super Mario", "LEGO ART", "LEGO Ideas", "LEGO Icons", "Disney Princess", "LEGO Harry Potter", "LEGO Vidiyo", "LEGO Minions", "LEGO Avatar", "LEGO Sonic", "LEGO DREAMZzz", "LEGO Gabby's Dollhouse", "LEGO Избрани", "LEGO Animal Crossing", "LEGO Fortnite", "LEGO Wednesday", "LEGO Horizon", "LEGO Wicked", "LEGO Despicable Me", "LEGO Botanicals", "LEGO Marvel", "LEGO Bluey", "LEGO One Piece"};

    // Aliases (common variants) -> preferred
    private static final Map<String, String> SERIES_ALIASES = new LinkedHashMap<>();
    private static final Map<String, String> SERIES_OVERRIDES = new LinkedHashMap<>();

    static {
        SERIES_ALIASES.put("LEGO DUPLO", "LEGO Duplo");
        SERIES_ALIASES.put("LEGO Duplo", "LEGO Duplo"); // idempotent
        SERIES_ALIASES.put("LEGO Spider-Man", "LEGO Spiderman");
        SERIES_ALIASES.put("LEGO Spider Man", "LEGO Spiderman");
        SERIES_ALIASES.put("LEGO Superheroes", "LEGO Super Heroes");
        SERIES_ALIASES.put("LEGO Super-Heroes", "LEGO Super Heroes");
        SERIES_ALIASES.put("LEGO Art", "LEGO ART");
        SERIES_ALIASES.put("LEGO Gabbys Dollhouse", "LEGO Gabby's Dollhouse");
        SERIES_ALIASES.put("LEGO Disney Princess", "LEGO Disney");
    }

    static {
        SERIES_OVERRIDES.put("LEGO Disney Princess", "LEGO Disney");
    }

    // Precompiled helpers for matching
    private static final Pattern TRADEMARKS = Pattern.compile("[®™©]");
    private static final Pattern APOSTROPHES_AND_HYPHENS = Pattern.compile("[-‘’'`´–—]");
    private static final Pattern MULTISPACE = Pattern.compile("\\s{2,}");
    private static final Pattern AGE_PLUS = Pattern.compile("(\\d+)\\s*\\+");
    private static final Pattern EXTRA_NAME_SYMBOLS = Pattern.compile("[:|,“”„ǀ│]");

    // For series matching: normalized (lowercase, no symbols, spaces collapsed) -> preferred
    private static final Map<String, String> SERIES_NORM_TO_PREFERRED = new LinkedHashMap<>();

    static {
        for (String s : SERIES_LIST) {
            SERIES_NORM_TO_PREFERRED.put(normalizeForMatch(s), s);
        }
    }

    public static void main(String[] args) {
        try {
            Path magentoPath = Paths.get(MAGENTO_IMPORT_FILE);
            Path scrapePath = Paths.get(LEGO_SCRAPE_FILE);
            Path outputPath = Paths.get(OUTPUT_MAIN_FILE);
            Path indexPath = Paths.get(OUTPUT_SECOND_FILE);

            Map<String, String> legoToSku = loadLegoToSku(magentoPath);

            // Compute news dates once per file creation
            LocalDate fromDate = LocalDate.now();
            LocalDate toDate = fromDate.plusDays(30);
            String newsFrom = fromDate.format(DATE_FMT);
            String newsTo = toDate.format(DATE_FMT);

            try (BufferedReader br = Files.newBufferedReader(scrapePath, StandardCharsets.UTF_8);
                 BufferedWriter bw = Files.newBufferedWriter(outputPath, StandardCharsets.UTF_8);
                 BufferedWriter bwIndex = Files.newBufferedWriter(indexPath, StandardCharsets.UTF_8)) {
                // MAIN CSV
                bw.write("\uFEFF"); // UTF-8 BOM for Excel
                String[] header = new String[]{"sku", "name", "series", "description", "age", "econt_length", "econt_width", "econt_height", "weight", "price", "product_online", "product_type", "attribute_set_code", "categories", "news_from_date", "news_to_date", "manufacturer", "responsible_entity_name", "responsible_entity_address", "responsible_entity_contact", "product_websites", "nomenclature_number", "base_image", "small_image", "thumbnail_image", "additional_images", "visibility", "sex"};
                writeCsvLine(bw, header);

                // SECOND CSV (IDX_F, IDX_H, IDX_O)
                bwIndex.write("\uFEFF"); // UTF-8 BOM for Excel
                writeCsvLine(bwIndex, new String[]{"lego_code", "name", "barcode"});

                String record;
                boolean maybeHeader = true;

                while ((record = readCsvRecord(br)) != null) {
                    String[] row = parseCsvLine(record);
                    if (row.length == 0) continue;

                    if (maybeHeader && looksLikeHeader(row)) {
                        maybeHeader = false;
                        continue;
                    }
                    maybeHeader = false;

                    if (!hasIndex(row)) continue;

                    // Required fields for index CSV
                    String legoCodeOut = safe(row, IDX_F).trim();
                    if (legoCodeOut.isEmpty()) continue;

                    String nameOut = cleanName(safe(row, IDX_H)).trim();
                    String barcodeOut = safe(row, IDX_O).trim();

                    // Write second CSV row (always, if lego code exists)
                    writeCsvLine(bwIndex, new String[]{legoCodeOut, nameOut, barcodeOut});

                    // MAIN output logic (only if SKU exists)
                    String sku = legoToSku.get(legoCodeOut);
                    if (sku == null || sku.isEmpty()) continue;

                    String bulletpoints = normalizeNewlines(safe(row, IDX_B));
                    String description = normalizeNewlines(safe(row, IDX_C));

                    String html = DescriptionHtmlBuilder.buildHtml(description, bulletpoints);
                    String htmlFlat = html.replace("\n", "<br>");

                    String rawNameH = safe(row, IDX_H); // main name
                    String rawNameE = safe(row, IDX_E); // alternative name
                    String picked = !rawNameH.isBlank() ? rawNameH : !rawNameE.isBlank() ? rawNameE : "";
                    String baseName = cleanName(picked);

                    // ---- Series detection & name normalization ----
                    String detectedSeriesOriginal = detectSeries(baseName);
                    String detectedSeries = applySeriesOverride(detectedSeriesOriginal);

                    String name;
                    if (detectedSeries != null) {
                        String preferredForName = stripSymbolsAndCollapse(detectedSeries);
                        String rest = stripSeriesFromName(baseName, detectedSeries).trim(); // remove series once
                        name = preferredForName + (rest.isEmpty() ? "" : " " + rest);
                    } else {
                        name = baseName;
                    }

                    String legoCode = safe(row, IDX_F).trim();
                    if (!legoCode.isEmpty()) {
                        name += " " + legoCode;
                    }

                    String age = convertAge(safe(row, IDX_M));
                    String lenCm = mmToCmString(safe(row, IDX_S));
                    String widCm = mmToCmString(safe(row, IDX_T));
                    String heiCm = mmToCmString(safe(row, IDX_U));
                    String weight = safe(row, IDX_Y);
                    String baseImage = safe(row, IDX_AC);
                    String base_image = baseImage;
                    String small_image = baseImage;
                    String thumbnail_image = baseImage;
                    String additional_images = joinNonBlank(safe(row, IDX_AD), safe(row, IDX_AE), safe(row, IDX_AF), safe(row, IDX_AG), safe(row, IDX_AH), safe(row, IDX_AI), safe(row, IDX_AJ));
                    String[] out = new String[]{sku, name, (detectedSeries == null ? "" : detectedSeries), htmlFlat, age, lenCm, widCm, heiCm, weight, PRICE, PRODUCT_ONLINE, PRODUCT_TYPE, ATTRIBUTE_SET_CODE, CATEGORIES, newsFrom, newsTo, MANUFACTURER, RESPONSIBLE_ENTITY_NAME, RESPONSIBLE_ENTITY_ADDRESS, RESPONSIBLE_ENTITY_CONTACT, STORE_ID, legoCodeOut, base_image, small_image, thumbnail_image, additional_images, VISIBILITY, SEX};
                    writeCsvLine(bw, out);
                }
            }
            System.out.println("✅ Done. Wrote: " + outputPath.toAbsolutePath());
            System.out.println("✅ Done. Wrote: " + indexPath.toAbsolutePath());

        } catch (IOException e) {
            System.err.println("I/O error while processing input: " + e.getMessage());
        }
    }

    // ==================== CSV Parsing ===================== \\
    private static void writeCsvLine(Writer w, String[] fields) throws IOException {
        for (int i = 0; i < fields.length; i++) {
            if (i > 0) w.write(',');
            w.write(csvEscape(fields[i]));
        }
        w.write("\n");
    }

    private static String csvEscape(String field) {
        if (field == null) field = "";
        boolean mustQuote = field.contains(",") || field.contains("\"") || field.contains("\n") || field.contains("\r");
        String escaped = field.replace("\"", "\"\"");
        return mustQuote ? "\"" + escaped + "\"" : escaped;
    }

    private static String readCsvRecord(BufferedReader reader) throws IOException {
        String line = reader.readLine();
        if (line == null) return null;

        StringBuilder sb = new StringBuilder(line);
        while (!isCompleteRecord(sb)) {
            String next = reader.readLine();
            if (next == null) break;
            sb.append("\n").append(next);
        }
        return sb.toString();
    }

    private static boolean isCompleteRecord(CharSequence text) {
        boolean inQuotes = false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"') {
                if (inQuotes && i + 1 < text.length() && text.charAt(i + 1) == '"') {
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            }
        }
        return !inQuotes;
    }

    // Normalize for pattern build
    private static String stripSymbolsAndCollapse(String s) {
        if (s == null) return "";
        String out = TRADEMARKS.matcher(s).replaceAll("");
        out = EXTRA_NAME_SYMBOLS.matcher(out).replaceAll(" ");
        out = out.replaceAll("[-‘’'`´–—]", " ");
        out = out.replaceAll("\\s+", " ").trim();
        return out;
    }

    private static String buildSeriesRegex(String preferred) {
        String p = stripSymbolsAndCollapse(preferred);
        String[] toks = p.split(" ");
        StringBuilder sb = new StringBuilder();
        sb.append("(?iu)\\b");
        for (int i = 0; i < toks.length; i++) {
            if (i > 0) sb.append("\\s+");
            sb.append(Pattern.quote(toks[i]));
        }
        sb.append("\\b");
        return sb.toString();
    }

    private static String stripSeriesFromName(String cleanedName, String preferred) {
        if (cleanedName == null || cleanedName.isBlank()) return cleanedName;
        String preferredForName = stripSymbolsAndCollapse(preferred);
        String[] toks = preferredForName.split(" ");
        StringBuilder sb = new StringBuilder();
        sb.append("(?iu)^\\s*");
        for (int i = 0; i < toks.length; i++) {
            if (i > 0) sb.append("\\s+");
            sb.append(Pattern.quote(toks[i]));
        }
        sb.append("\\s*");

        Pattern p = Pattern.compile(sb.toString());
        Matcher m = p.matcher(cleanedName);
        if (m.find()) {
            String rest = cleanedName.substring(m.end());
            return rest.replaceAll("\\s{2,}", " ").trim();
        }
        return cleanedName;
    }

    private static String[] parseCsvLine(String line) {
        List<String> out = new ArrayList<>();
        if (line == null) return new String[0];

        StringBuilder cur = new StringBuilder();
        boolean inQuotes = false;

        for (int i = 0; i < line.length(); i++) {
            char c = line.charAt(i);
            if (c == '"') {
                if (inQuotes && i + 1 < line.length() && line.charAt(i + 1) == '"') {
                    cur.append('"');
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (c == ',' && !inQuotes) {
                out.add(cur.toString());
                cur.setLength(0);
            } else {
                cur.append(c);
            }
        }
        out.add(cur.toString());
        return out.toArray(new String[0]);
    }

    // ==================== Utils & Transformers ===================== \\
    private static Map<String, String> loadLegoToSku(Path magentoPath) throws IOException {
        Map<String, String> map = new HashMap<>();
        try (BufferedReader br = Files.newBufferedReader(magentoPath, StandardCharsets.UTF_8)) {
            String record;
            boolean maybeHeader = true;
            while ((record = readCsvRecord(br)) != null) {
                String[] row = parseCsvLine(record);
                if (row.length == 0) continue;
                if (maybeHeader && looksLikeHeader(row)) {
                    maybeHeader = false;
                    continue;
                }
                maybeHeader = false;

                String lego = get(row, 0);
                String sku = get(row, 1);
                if (!lego.isEmpty() && !sku.isEmpty()) {
                    map.put(lego.trim(), sku.trim());
                }
            }
        }
        return map;
    }

    private static boolean looksLikeHeader(String[] row) {
        String joined = String.join(" ", row).toLowerCase(Locale.ROOT);
        return joined.contains("lego") || joined.contains("sku") || joined.contains("name") || joined.contains("description");
    }

    private static boolean hasIndex(String[] row) {
        return LegoCsvBuilderNoDeps.IDX_Y < row.length;
    }

    private static String get(String[] row, int idx) {
        return (idx >= 0 && idx < row.length && row[idx] != null) ? row[idx] : "";
    }

    private static String safe(String[] row, int idx) {
        String s = get(row, idx);
        return s == null ? "" : s;
    }

    private static String normalizeNewlines(String s) {
        if (s == null) return "";
        return s.replace("\r\n", "\n").replace("\r", "\n");
    }

    private static String cleanName(String s) {
        if (s == null) return "";
        String out = TRADEMARKS.matcher(s).replaceAll("");
        out = EXTRA_NAME_SYMBOLS.matcher(out).replaceAll(" ");
        out = APOSTROPHES_AND_HYPHENS.matcher(out).replaceAll(" ");
        out = MULTISPACE.matcher(out).replaceAll(" ").trim();
        return out;
    }

    private static String convertAge(String raw) {
        if (raw == null) return "";
        Matcher m = AGE_PLUS.matcher(raw.trim());
        if (m.find()) return "Над " + m.group(1) + " г.";
        return raw.trim();
    }

    private static String mmToCmString(String mm) {
        if (mm == null) return "";
        try {
            double valMm = Double.parseDouble(mm.replace(',', '.').trim());
            double cm = valMm / 10.0;
            return String.format(Locale.ROOT, "%.2f", cm).replaceAll("0+$", "").replaceAll("\\.$", "");
        } catch (Exception e) {
            return mm.trim();
        }
    }

    // ================ Series detection & normalization ================ \\
    // Normalize for matching: lowercase, remove ™®©, unify hyphens/apostrophes to spaces, collapse spaces
    private static String normalizeForMatch(String s) {
        if (s == null) return "";
        String out = s;
        out = TRADEMARKS.matcher(out).replaceAll("");
        out = EXTRA_NAME_SYMBOLS.matcher(out).replaceAll(" ");
        out = APOSTROPHES_AND_HYPHENS.matcher(out).replaceAll(" ");
        out = out.toLowerCase(Locale.ROOT).trim();
        out = out.replaceAll("\\s+", " ");
        return out;
    }

    // Return preferred series (from SERIES_LIST) if found in name; else null
    private static String detectSeries(String productNameCleaned) {
        String name = stripSymbolsAndCollapse(productNameCleaned);
        String best = null;
        int bestLen = -1;

        // 1) alias checks
        for (Map.Entry<String, String> e : SERIES_ALIASES.entrySet()) {
            String alias = e.getKey();
            String preferred = e.getValue();
            if (name.matches(".*" + buildSeriesRegex(alias) + ".*")) {
                int len = stripSymbolsAndCollapse(preferred).length();
                if (len > bestLen) {
                    best = preferred;
                    bestLen = len;
                }
            }
        }

        // 2) preferred list checks
        for (String preferred : SERIES_LIST) {
            if (name.matches(".*" + buildSeriesRegex(preferred) + ".*")) {
                int len = stripSymbolsAndCollapse(preferred).length();
                if (len > bestLen) {
                    best = preferred;
                    bestLen = len;
                }
            }
        }
        return applySeriesOverride(best);
    }

    private static String applySeriesOverride(String detected) {
        if (detected == null || detected.isBlank()) return detected;
        String key = stripSymbolsAndCollapse(detected).trim();
        String repl = SERIES_OVERRIDES.get(key);
        return (repl != null && !repl.isBlank()) ? repl : detected;
    }

    private static String joinNonBlank(String... values) {
        StringBuilder sb = new StringBuilder();
        for (String v : values) {
            if (v != null && !v.isBlank()) {
                if (!sb.isEmpty()) sb.append(",");
                sb.append(v.trim());
            }
        }
        return sb.toString();
    }
}