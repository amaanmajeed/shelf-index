/** Apply site theme ASAP. Default dark; `shelfIndexDark: false` → light. */
(function () {
  const KEY = "shelfIndexDark";

  function apply(dark) {
    document.documentElement.classList.toggle("si-light", dark === false);
  }

  apply(true);
  try {
    chrome.storage.local.get([KEY], (r) => apply(r[KEY] !== false));
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === "local" && KEY in ch) apply(ch[KEY].newValue !== false);
    });
  } catch (_e) {}
})();
