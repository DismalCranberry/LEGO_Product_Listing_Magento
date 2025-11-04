chrome.action.onClicked.addListener(async (tab) => {
    if (!tab?.id) return;
    try {
        const [{result}] = await chrome.scripting.executeScript({
            target: {tabId: tab.id}, func: () => window.__DormantScraper__?.run?.(), args: []
        });

        if (!result) return;

        const json = JSON.stringify(result, null, 2);
        const blob = new Blob([json], {type: "application/json"});
        const url = URL.createObjectURL(blob);
        const filename = `scrape-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;

        await chrome.downloads.download({url, filename, saveAs: false});
        try {
            await navigator.clipboard.writeText(json);
        } catch {
        }

        console.log("Dormant DOM Label Scraper ->", result);
    } catch (e) {
        console.error("Dormant DOM Label Scraper error:", e);
    }
});