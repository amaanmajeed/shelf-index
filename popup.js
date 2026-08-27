const DASHBOARD_URL =
  "https://odoo.codingcops.com/odoo/action-672#menu_id=454";

function fmt(h) {
  if (h == null || isNaN(h)) return "—";
  const totalMin = Math.round(Math.abs(h) * 60);
  const s =
    (h < 0 ? "-" : "") +
    Math.floor(totalMin / 60) +
    ":" +
    String(totalMin % 60).padStart(2, "0");
  return s;
}

function showLast(last) {
  const el = document.getElementById("status");
  if (!last) {
    el.textContent = "No index yet. Open the workspace page and refresh.";
    return;
  }
  const vs =
    last.vsToday == null || isNaN(last.vsToday)
      ? ""
      : " · " + (last.vsToday > 0 ? "+" : "") + fmt(last.vsToday);
  el.textContent =
    "Banked " +
    fmt(last.banked) +
    (last.target != null ? " / " + last.target + "h" : "") +
    " · Remaining " +
    fmt(last.needed) +
    vs +
    (last.updatedAt
      ? "\nUpdated " + new Date(last.updatedAt).toLocaleString()
      : "");
}

const THEME_KEY = "shelfIndexDark";

function paintTheme(dark) {
  document.body.classList.toggle("si-light", !dark);
}

chrome.storage.local.get(["shelfIndexLastResult", THEME_KEY], (r) => {
  showLast(r.shelfIndexLastResult);
  paintTheme(r[THEME_KEY] !== false);
});

chrome.storage.onChanged.addListener((ch, area) => {
  if (area === "local" && THEME_KEY in ch) paintTheme(ch[THEME_KEY].newValue !== false);
});

document.getElementById("clear").addEventListener("click", async () => {
  await chrome.storage.local.clear();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab && tab.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "shelfIndexClear" });
    } catch (_e) {}
  }
  paintTheme(true);
  document.getElementById("status").textContent = "Cleared.";
});

document.getElementById("analyze").addEventListener("click", async () => {
  const status = document.getElementById("status");
  status.textContent = "Working…";

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  let tab = tabs[0];

  if (!tab || !tab.url || !tab.url.startsWith("https://odoo.codingcops.com/")) {
    tab = await chrome.tabs.create({ url: DASHBOARD_URL, active: true });
    status.textContent =
      "Opened the workspace page. Sign in if needed, wait for it to load, then refresh again.";
    return;
  }

  if (!/action-672/.test(tab.url)) {
    await chrome.tabs.update(tab.id, { url: DASHBOARD_URL });
    status.textContent =
      "Navigated to the workspace page. Wait for it to load, then refresh again.";
    return;
  }

  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "shelfIndexAnalyze",
    });
    if (!res || !res.ok) {
      status.textContent =
        "Error: " + ((res && res.error) || "no response — reload the page");
      return;
    }
    status.textContent =
      "Banked " +
      fmt(res.banked) +
      (res.target != null ? " / " + res.target + "h" : "") +
      " · Remaining " +
      fmt(res.needed) +
      (res.vsToday == null || isNaN(res.vsToday)
        ? ""
        : " · " + (res.vsToday > 0 ? "+" : "") + fmt(res.vsToday));
  } catch (e) {
    status.textContent =
      "Could not reach the page script. Reload the tab and try again.\n" +
      (e.message || e);
  }
});
