(async function () {
  const SI = globalThis.ShelfIndex;
  const PANEL_ID = "shelf-index-panel";
  const NAV_ID = "shelf-index-nav";
  const STORAGE_OVERRIDES = "shelfIndexOverrides";
  const STORAGE_LAST = "shelfIndexLastResult";
  const STORAGE_CACHE = "shelfIndexDayCache";
  const STORAGE_DAILY = "shelfIndexDailyHours";

  let editingKey = null; // force inline editor on this day (Edit button)
  let skippedKeys = {}; // cancelled editors — show label until Edit
  let lastSummary = null;
  let lastDays = null;
  let lastOverrides = {};
  let lastDaily = 9;

  function extAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (_e) {
      return false;
    }
  }

  function showReloadNeeded() {
    const el = document.getElementById(PANEL_ID);
    if (el) {
      el.querySelector(".si-body").textContent =
        "Extension was reloaded. Refresh this page (F5) to edit again.";
    }
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      if (!extAlive()) {
        reject(new Error("Extension context invalidated"));
        return;
      }
      try {
        chrome.storage.local.get(keys, resolve);
      } catch (e) {
        reject(e);
      }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve, reject) => {
      if (!extAlive()) {
        reject(new Error("Extension context invalidated"));
        return;
      }
      try {
        chrome.storage.local.set(obj, resolve);
      } catch (e) {
        reject(e);
      }
    });
  }

  async function fetchDailyHours() {
    const url =
      "/web/dataset/call_kw/hr.employee/get_daily_hours_worked_current_month";
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: {
          model: "hr.employee",
          method: "get_daily_hours_worked_current_month",
          args: [],
          kwargs: {},
        },
        id: Date.now(),
      }),
    });
    if (!res.ok) throw new Error("RPC HTTP " + res.status);
    const body = await res.json();
    if (body.error) {
      throw new Error(
        (body.error.data && body.error.data.message) ||
          body.error.message ||
          "RPC error"
      );
    }
    return body.result || [];
  }

  async function getDays() {
    try {
      const days = await fetchDailyHours();
      // cache is best-effort — don't fail the run if extension was reloaded
      if (extAlive()) {
        try {
          await storageSet({
            [STORAGE_CACHE]: { fetchedAt: Date.now(), days },
          });
        } catch (_e) {}
      }
      return days;
    } catch (e) {
      if (/invalidated/i.test(String(e && e.message))) throw e;
      try {
        if (extAlive()) {
          const cached = (await storageGet([STORAGE_CACHE]))[STORAGE_CACHE];
          if (cached && cached.days && cached.days.length) return cached.days;
        }
      } catch (_e) {}
      throw e;
    }
  }

  async function getOverrides() {
    const o = (await storageGet([STORAGE_OVERRIDES]))[STORAGE_OVERRIDES] || {};
    lastOverrides = o;
    return o;
  }

  async function setOverride(key, value) {
    const overrides = await getOverrides();
    overrides[key] = value;
    await storageSet({ [STORAGE_OVERRIDES]: overrides });
    lastOverrides = overrides;
    return overrides;
  }

  async function getDailyHours() {
    const v = (await storageGet([STORAGE_DAILY]))[STORAGE_DAILY];
    lastDaily = +v === 6 ? 6 : 9;
    return lastDaily;
  }

  async function setDailyHours(n) {
    lastDaily = +n === 6 ? 6 : 9;
    await storageSet({ [STORAGE_DAILY]: lastDaily });
    return lastDaily;
  }

  function summarize(days, overrides, daily) {
    return SI.summarizeWeek(days, overrides, new Date(), daily || lastDaily);
  }

  function syncDailyToggle(panel, daily) {
    panel.querySelectorAll(".si-daily").forEach((btn) => {
      btn.classList.toggle("si-daily-on", +btn.getAttribute("data-daily") === daily);
    });
  }

  // ponytail: Friday is the day we calculate leave for — never ask for it
  function isFriday(d) {
    return d.weekday === 5 || d.label === "Fri";
  }

  /** Split a Date / hhmm into { hh12, mm, mer } for the editor. */
  function splitEditorTime(raw) {
    let h = 18;
    let min = 0;
    if (raw) {
      const t = typeof raw === "string" ? SI.parseUserTime(raw) : null;
      if (t) {
        h = t.h;
        min = t.min;
      } else {
        const d = raw instanceof Date ? raw : SI.parseOdooDt(raw);
        if (d) {
          const parts = new Intl.DateTimeFormat("en-GB", {
            timeZone: SI.TZ,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }).formatToParts(d);
          const get = (x) => parts.find((p) => p.type === x).value;
          h = +get("hour");
          min = +get("minute");
        }
      }
    }
    const mer = h >= 12 ? "pm" : "am";
    let hh12 = h % 12;
    if (hh12 === 0) hh12 = 12;
    return {
      hh: String(hh12),
      mm: (min < 10 ? "0" : "") + min,
      mer: mer,
    };
  }

  /** Icon button — Odoo already loads Font Awesome. */
  function iconBtn(cls, key, label, fa) {
    return (
      '<button type="button" class="si-icon ' +
      cls +
      '" data-key="' +
      key +
      '" title="' +
      label +
      '" aria-label="' +
      label +
      '"><i class="fa ' +
      fa +
      '"></i></button>'
    );
  }

  function timeEditorHtml(d, overrides, field) {
    field = field || "leave";
    const o = overrides && overrides[d.key];
    const pref =
      field === "start"
        ? (o && o.start) || d.start || null
        : (o && o.leave) ||
          (d.endKind === "projected" && d.end) ||
          d.end ||
          null;
    const s = splitEditorTime(pref);
    return (
      '<span class="si-time-edit" data-key="' +
      d.key +
      '" data-field="' +
      field +
      '">' +
      '<input class="si-hh" type="text" inputmode="numeric" maxlength="2" value="' +
      s.hh +
      '" aria-label="Hour">' +
      "<span>:</span>" +
      '<input class="si-mm" type="text" inputmode="numeric" maxlength="2" value="' +
      s.mm +
      '" aria-label="Minute">' +
      '<select class="si-mer" aria-label="AM/PM">' +
      '<option value="am"' +
      (s.mer === "am" ? " selected" : "") +
      ">am</option>" +
      '<option value="pm"' +
      (s.mer === "pm" ? " selected" : "") +
      ">pm</option>" +
      "</select>" +
      iconBtn("si-save", d.key, "Save", "fa-check") +
      iconBtn("si-cancel", d.key, "Cancel", "fa-times") +
      "</span>"
    );
  }

  function hoursEditorHtml(d, overrides) {
    const prev =
      overrides && overrides[d.key] && typeof overrides[d.key].hours === "number"
        ? overrides[d.key].hours
        : "";
    const holidayBtn = canMarkHoliday(d)
      ? iconBtn("si-holiday", d.key, "Holiday", "fa-sun-o")
      : "";
    return (
      '<span class="si-hours-edit" data-key="' +
      d.key +
      '">' +
      '<input class="si-hours" type="text" inputmode="decimal" value="' +
      prev +
      '" placeholder="hrs" aria-label="Hours">' +
      iconBtn("si-save-hours", d.key, "Save", "fa-check") +
      holidayBtn +
      iconBtn("si-cancel", d.key, "Cancel", "fa-times") +
      "</span>"
    );
  }

  function formatVsToday(h) {
    if (h == null || isNaN(h)) return "";
    const s = SI.formatHours(h);
    return (h > 0 ? "+" : "") + s;
  }

  /** Holiday only when neither check-in nor check-out exists. */
  function canMarkHoliday(d) {
    return !d.checkIn && !d.checkOut && d.status !== "holiday";
  }

  function ensureNavBtn() {
    if (document.getElementById(NAV_ID)) return true;
    const systray = document.querySelector(".o_menu_systray");
    if (!systray) return false;
    const bellIcon = systray.querySelector(".fa-bell");
    const bell =
      bellIcon && bellIcon.closest(".o_mail_navbar_item, .dropdown, div");
    const wrap = document.createElement("div");
    wrap.id = NAV_ID;
    wrap.className = "o_nav_entry d-flex align-items-center";
    wrap.innerHTML =
      '<a href="#" class="si-nav-btn d-flex align-items-center" title="Shelf Index" role="button" aria-label="Shelf Index"><i class="fa fa-clock-o"></i></a>';
    wrap.querySelector("a").addEventListener("click", (e) => {
      e.preventDefault();
      run().catch((err) => {
        if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
      });
    });
    if (bell) systray.insertBefore(wrap, bell);
    else systray.appendChild(wrap);
    return true;
  }

  function watchNav() {
    ensureNavBtn();
    new MutationObserver(() => ensureNavBtn()).observe(
      document.documentElement,
      { childList: true, subtree: true }
    );
  }

  function ensurePanel() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = PANEL_ID;
    el.innerHTML =
      '<div class="si-head"><strong>Shelf Index</strong>' +
      '<span class="si-mode" title="Daily hours target">' +
      '<button type="button" class="si-daily si-daily-on" data-daily="9">9h</button>' +
      '<button type="button" class="si-daily" data-daily="6">6h</button>' +
      "</span>" +
      '<button type="button" class="si-icon si-refresh" title="Refresh" aria-label="Refresh"><i class="fa fa-refresh"></i></button>' +
      '<button type="button" class="si-icon si-close" title="Close" aria-label="Close"><i class="fa fa-times"></i></button></div>' +
      '<div class="si-body">Loading…</div>';
    document.documentElement.appendChild(el);
    el.querySelector(".si-close").addEventListener("click", () => el.remove());
    el.querySelector(".si-refresh").addEventListener("click", () => {
      run().catch((err) => {
        if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
      });
    });
    el.addEventListener("click", onPanelClick);
    // select-all on focus so typing replaces hour/min without backspacing
    el.addEventListener("focusin", (e) => {
      const inp = e.target.closest(".si-hh, .si-mm, .si-hours");
      if (!inp) return;
      requestAnimationFrame(() => inp.select());
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const timeEd = e.target.closest(".si-time-edit");
      if (timeEd) {
        e.preventDefault();
        saveTime(timeEd.getAttribute("data-key")).catch((err) => {
          if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
        });
        return;
      }
      const hoursEd = e.target.closest(".si-hours-edit");
      if (hoursEd) {
        e.preventDefault();
        saveHours(hoursEd.getAttribute("data-key")).catch((err) => {
          if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
        });
      }
    });
    return el;
  }

  function onPanelClick(e) {
    const dailyBtn = e.target.closest(".si-daily");
    if (dailyBtn) {
      const n = +dailyBtn.getAttribute("data-daily");
      setDailyHours(n)
        .then(() => refreshFromState())
        .catch((err) => {
          if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
        });
      return;
    }
    const edit = e.target.closest(".si-edit");
    if (edit) {
      const key = edit.getAttribute("data-key");
      editingKey = key;
      delete skippedKeys[key];
      if (lastSummary) {
        renderPanel(lastSummary).catch((err) => {
          if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
        });
      }
      return;
    }
    const cancel = e.target.closest(".si-cancel");
    if (cancel) {
      const key = cancel.getAttribute("data-key");
      editingKey = null;
      skippedKeys[key] = true;
      if (lastSummary) {
        renderPanel(lastSummary).catch((err) => {
          if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
        });
      }
      return;
    }
    const save = e.target.closest(".si-save");
    if (save) {
      saveTime(save.getAttribute("data-key")).catch((err) => {
        if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
      });
      return;
    }
    const saveH = e.target.closest(".si-save-hours");
    if (saveH) {
      saveHours(saveH.getAttribute("data-key")).catch((err) => {
        if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
      });
      return;
    }
    const holiday = e.target.closest(".si-holiday");
    if (holiday) {
      markHoliday(holiday.getAttribute("data-key")).catch((err) => {
        if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
      });
      return;
    }
    const unholiday = e.target.closest(".si-unholiday");
    if (unholiday) {
      clearOverride(unholiday.getAttribute("data-key"))
        .then(() => refreshFromState())
        .catch((err) => {
          if (/invalidated/i.test(String(err && err.message))) showReloadNeeded();
        });
    }
  }

  function timeCell(label, kind) {
    const cls =
      kind === "entered"
        ? "si-entered"
        : kind === "projected"
          ? "si-projected"
          : "";
    return '<td class="' + cls + '">' + (label || "—") + "</td>";
  }

  function wantsLeaveEditor(d) {
    if (isFriday(d) || d.status === "holiday") return false;
    if (editingKey !== d.key || skippedKeys[d.key]) return false;
    return !!(d.status === "leave_time" || d.checkIn);
  }

  function wantsHoursEditor(d) {
    if (isFriday(d) || d.status === "holiday" || d.status === "projected")
      return false;
    if (editingKey !== d.key || skippedKeys[d.key]) return false;
    return (
      d.status === "manual" ||
      d.status === "needs_hours" ||
      (d.is_absent && !d.checkIn)
    );
  }

  /** No Odoo check-in: enter start so leave can be projected (Thu/Fri, or any day you weren't there). */
  function wantsStartEditor(d) {
    if (d.status === "holiday" || d.checkIn) return false;
    if (editingKey !== d.key || skippedKeys[d.key]) return false;
    return (
      d.status === "projected" ||
      d.status === "future" ||
      d.status === "missing" ||
      d.startKind === "entered" ||
      d.startKind === "projected"
    );
  }

  async function renderPanel(summary) {
    const el = ensurePanel();
    let overrides = lastOverrides;
    if (extAlive()) {
      try {
        overrides = await getOverrides();
      } catch (e) {
        if (/invalidated/i.test(String(e && e.message))) {
          showReloadNeeded();
          throw e;
        }
      }
    } else {
      showReloadNeeded();
      throw new Error("Extension context invalidated");
    }
    lastSummary = summary;
    syncDailyToggle(el, summary.dailyHours || lastDaily);
    const rows = summary.perDay
      .map((d) => {
        if (d.status === "holiday") {
          return (
            '<tr class="si-holiday-row"><td>' +
            d.label +
            "</td>" +
            timeCell("—", "") +
            timeCell("—", "") +
            "<td>" +
            SI.formatHours(d.hours) +
            '</td><td class="si-note">holiday ' +
            iconBtn("si-unholiday", d.key, "Clear holiday", "fa-times") +
            "</td></tr>"
          );
        }
        const leaveEd = wantsLeaveEditor(d);
        const hoursEd = !leaveEd && wantsHoursEditor(d);
        const startEd = !leaveEd && !hoursEd && wantsStartEditor(d);
        const startCell = startEd
          ? '<td class="si-edit-cell">' +
            timeEditorHtml(d, overrides, "start") +
            "</td>"
          : timeCell(d.startLabel, d.startKind);
        const endCell = leaveEd
          ? '<td class="si-edit-cell">' +
            timeEditorHtml(d, overrides, "leave") +
            "</td>"
          : timeCell(d.endLabel, d.endKind);
        const hoursCell = hoursEd
          ? '<td class="si-edit-cell">' + hoursEditorHtml(d, overrides) + "</td>"
          : "<td>" + SI.formatHours(d.hours) + "</td>";
        const canEditStart = !d.checkIn && (d.weekday === 4 || d.weekday === 5);
        const canEditOther =
          !isFriday(d) &&
          (d.status === "leave_time" ||
            d.status === "manual" ||
            d.status === "needs_leave" ||
            d.status === "needs_hours" ||
            d.status === "projected" ||
            (d.missing_checkout && d.checkIn) ||
            (d.is_absent && !d.checkIn));
        const canEdit =
          !leaveEd && !hoursEd && !startEd && (canEditStart || canEditOther);
        const holidayBtn =
          !hoursEd && canMarkHoliday(d)
            ? iconBtn("si-holiday", d.key, "Holiday", "fa-sun-o")
            : "";
        const note = canEdit
          ? iconBtn("si-edit", d.key, "Edit", "fa-pencil") + holidayBtn
          : holidayBtn
            ? holidayBtn
            : d.status === "projected"
              ? "projected"
              : "";
        return (
          "<tr><td>" +
          d.label +
          "</td>" +
          startCell +
          endCell +
          hoursCell +
          '<td class="si-note">' +
          note +
          "</td></tr>"
        );
      })
      .join("");
    const vs = summary.vsToday;
    const vsCls =
      vs > 0.008 ? "si-ahead" : vs < -0.008 ? "si-behind" : "si-even";
    const vsHtml =
      vs == null || isNaN(vs)
        ? ""
        : ' · <span class="' +
          vsCls +
          '" title="vs completed days (check-in + check-out)">' +
          formatVsToday(vs) +
          "</span>";
    el.querySelector(".si-body").innerHTML =
      '<p class="si-focus">' +
      summary.focus +
      "</p>" +
      "<p>Banked <b>" +
      SI.formatHours(summary.banked) +
      "</b> / " +
      summary.target +
      "h · Remaining <b>" +
      SI.formatHours(summary.needed) +
      "</b>" +
      vsHtml +
      "</p>" +
      '<table class="si-table"><thead><tr><th>Day</th><th>Start</th><th>End</th><th>Hours</th><th></th></tr></thead><tbody>' +
      rows +
      "</tbody></table>";
    focusHourInput(el);
  }

  function focusHourInput(panel) {
    if (!editingKey) return;
    const root = panel.querySelector(
      '.si-time-edit[data-key="' +
        editingKey +
        '"], .si-hours-edit[data-key="' +
        editingKey +
        '"]'
    );
    if (!root) return;
    const field = root.querySelector(".si-hh, .si-hours");
    if (!field) return;
    requestAnimationFrame(() => {
      field.focus();
      field.select();
    });
  }

  async function persist(summary) {
    await storageSet({
      [STORAGE_LAST]: {
        banked: summary.banked,
        needed: summary.needed,
        vsToday: summary.vsToday,
        target: summary.target,
        focus: summary.focus,
        weekStart: summary.weekStart,
        perDay: summary.perDay,
        updatedAt: Date.now(),
      },
    });
  }

  function readTimeEdit(key) {
    const root = document.querySelector(
      '.si-time-edit[data-key="' + key + '"]'
    );
    if (!root) return null;
    const hh = root.querySelector(".si-hh").value.trim();
    const mm = root.querySelector(".si-mm").value.trim();
    const mer = root.querySelector(".si-mer").value;
    return hh + ":" + (mm.length === 1 ? "0" + mm : mm) + mer;
  }

  async function refreshFromState() {
    const days = lastDays || (await getDays());
    lastDays = days;
    const overrides = await getOverrides();
    const daily = await getDailyHours();
    const summary = summarize(days, overrides, daily);
    await renderPanel(summary);
    await persist(summary);
    return summary;
  }

  async function saveTime(key) {
    const root = document.querySelector(
      '.si-time-edit[data-key="' + key + '"]'
    );
    if (root && root.getAttribute("data-field") === "start") {
      return saveStart(key);
    }
    return saveLeave(key);
  }

  async function saveStart(key) {
    const raw = readTimeEdit(key);
    const parsed = SI.parseUserTime(raw);
    if (!parsed) {
      window.alert("Invalid time.");
      return;
    }
    await setOverride(key, { start: parsed.hhmm });
    editingKey = null;
    await refreshFromState();
  }

  async function saveLeave(key) {
    const raw = readTimeEdit(key);
    const parsed = SI.parseUserTime(raw);
    if (!parsed) {
      window.alert("Invalid time.");
      return;
    }
    const d =
      lastSummary && lastSummary.perDay.find((x) => x.key === key);
    const checkIn = d && SI.parseOdooDt(d.checkIn);
    const leaveDt = SI.parseTimeOnDay(key, parsed.hhmm);
    if (checkIn && leaveDt && leaveDt <= checkIn) {
      window.alert(
        "End must be after start (" + SI.formatPktTime(d.checkIn) + ")."
      );
      return;
    }
    await setOverride(key, { leave: parsed.hhmm });
    editingKey = null;
    await refreshFromState();
  }

  async function saveHours(key) {
    const root = document.querySelector(
      '.si-hours-edit[data-key="' + key + '"]'
    );
    if (!root) return;
    const h = parseFloat(root.querySelector(".si-hours").value);
    if (isNaN(h) || h < 0 || h > 24) {
      window.alert("Enter hours between 0 and 24.");
      return;
    }
    await setOverride(key, { hours: h });
    editingKey = null;
    await refreshFromState();
  }

  async function markHoliday(key) {
    const d =
      lastSummary && lastSummary.perDay.find((x) => x.key === key);
    if (!d || !canMarkHoliday(d)) return;
    // ponytail: holiday drops the week target by one daily slice; hours stay 0
    await setOverride(key, { holiday: true });
    editingKey = null;
    delete skippedKeys[key];
    await refreshFromState();
  }

  async function clearOverride(key) {
    const overrides = await getOverrides();
    delete overrides[key];
    await storageSet({ [STORAGE_OVERRIDES]: overrides });
    lastOverrides = overrides;
    editingKey = null;
  }

  async function run() {
    const panel = ensurePanel();
    if (!extAlive()) {
      showReloadNeeded();
      return null;
    }
    panel.querySelector(".si-body").textContent = "Indexing…";
    editingKey = null;
    skippedKeys = {};
    try {
      const days = await getDays();
      lastDays = days;
      const overrides = await getOverrides();
      const daily = await getDailyHours();
      const summary = summarize(days, overrides, daily);
      await renderPanel(summary);
      await persist(summary);
      return summary;
    } catch (e) {
      if (/invalidated/i.test(String(e && e.message))) {
        showReloadNeeded();
        return null;
      }
      panel.querySelector(".si-body").textContent =
        "Could not load index: " + (e.message || e);
      throw e;
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "shelfIndexClear") {
      lastOverrides = {};
      lastDays = null;
      lastSummary = null;
      lastDaily = 9;
      editingKey = null;
      skippedKeys = {};
      const el = document.getElementById(PANEL_ID);
      if (el) el.remove();
      sendResponse({ ok: true });
      return;
    }
    if (msg && msg.type === "shelfIndexAnalyze") {
      run()
        .then((s) =>
          sendResponse({
            ok: true,
            banked: s.banked,
            needed: s.needed,
            vsToday: s.vsToday,
            target: s.target,
            focus: s.focus,
          })
        )
        .catch((e) =>
          sendResponse({ ok: false, error: String(e.message || e) })
        );
      return true;
    }
  });

  watchNav();
})();
