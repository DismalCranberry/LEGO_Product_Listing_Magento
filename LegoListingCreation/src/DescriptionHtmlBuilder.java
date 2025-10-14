import java.util.ArrayList;
import java.util.List;

public class DescriptionHtmlBuilder {
    private static final String BULLET_POINT_DELIMITER = "(?:\\r?\\n){2,}";

    public static String buildHtml(String description, String bulletPoints) {
        StringBuilder html = new StringBuilder();

        String firstParagraph = extractFirstParagraph(description);

        html.append("<p>").append(escapeHtml(firstParagraph)).append("</p>").append("<br>").append("<ul>");

        List<String> items = splitBulletPoints(bulletPoints);
        for (String item : items) {
            if (!item.isBlank()) {
                html.append("<li>").append(escapeHtml(item.trim())).append("</li>");
            }
        }
        html.append("</ul>");
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

        String[] byBlank = bulletPoints.split(BULLET_POINT_DELIMITER);
        if (byBlank.length > 1) {
            for (String s : byBlank) {
                String t = s.trim();
                if (!t.isBlank()) out.add(t);
            }
        } else {
            for (String line : bulletPoints.split("\\R")) {
                String t = line.replaceFirst("^\\s*[•\\-–—]\\s*", "").trim();
                if (!t.isBlank()) out.add(t);
            }
        }
        return out;
    }

    private static String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
    }
}
