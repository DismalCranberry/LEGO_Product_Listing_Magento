import java.util.ArrayList;
import java.util.List;

public class DescriptionHtmlBuilder {
    // two or more newlines separate paragraphs/blocks
    private static final String BULLET_POINT_DELIMITER = "(?:\\r?\\n){2,}";

    public static String buildHtml(String description, String bulletPoints) {
        StringBuilder html = new StringBuilder();

        String firstParagraph = extractFirstParagraph(description);
        if (!firstParagraph.isBlank()) {
            html.append("<p>").append(escapeHtml(firstParagraph)).append("</p>");
        }

        List<String> items = splitBulletPoints(bulletPoints);
        if (!items.isEmpty()) {
            html.append("<ul>");
            for (String item : items) {
                html.append("<li>").append(escapeHtml(item)).append("</li>");
            }
            html.append("</ul>");
        }

        return html.toString();
    }

    private static String extractFirstParagraph(String text) {
        if (text == null || text.isBlank()) return "";
        String[] paras = text.split(BULLET_POINT_DELIMITER, 2);
        return paras[0].trim();
    }

    private static List<String> splitBulletPoints(String bulletPoints) {
        List<String> out = new ArrayList<>();
        if (bulletPoints == null || bulletPoints.isBlank()) return out;

        // 1) If pipes are present, treat them as separators (common in feeds)
        if (bulletPoints.indexOf('|') >= 0) {
            for (String part : bulletPoints.split("\\s*\\|\\s*")) {
                String t = part.trim();
                if (!t.isBlank()) out.add(t);
            }
            return out;
        }

        // 2) If there are blank-line breaks, split into blocks
        String[] byBlank = bulletPoints.split(BULLET_POINT_DELIMITER);
        if (byBlank.length > 1) {
            for (String s : byBlank) {
                String t = s.trim();
                if (!t.isBlank()) out.add(t);
            }
            return out;
        }

        // 3) Otherwise, split per line and remove common bullet markers
        for (String line : bulletPoints.split("\\R")) {
            String t = line.replaceFirst("^\\s*[•\\-–—]\\s*", "").trim();
            if (!t.isBlank()) out.add(t);
        }
        return out;
    }

    private static String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
