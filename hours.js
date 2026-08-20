/** Pure week math. Loaded before content.js; also runnable via check.js. */
(function (root) {
  const WEEK_TARGET = 45; // 9h × 5 — default; 6h/day → 30
  const TZ = "Asia/Karachi";
  const DASHBOARD_URL =
    "https://odoo.codingcops.com/odoo/action-672#menu_id=454";

  function weekTargetForDaily(dailyHours) {
    const d = +dailyHours === 6 ? 6 : 9;
    return d * 5;
  }

  function pad(n) {
    return n < 10 ? "0" + n : String(n);
  }

  /** Calendar YYYY-MM-DD in Asia/Karachi. */
  function dateKey(d) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d instanceof Date ? d : new Date(d));
    const get = (t) => parts.find((p) => p.type === t).value;
    return get("year") + "-" + get("month") + "-" + get("day");
  }

  /** Weekday 1=Mon … 7=Sun in Asia/Karachi (ISO). */
  function weekdayMon1(d) {
    const name = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
    }).format(d instanceof Date ? d : new Date(d));
    return { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[name];
  }

  function parseDayDate(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    const s = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return new Date(s + "T12:00:00+05:00");
    }
    return parseOdooDt(s);
  }

  /** Odoo stores naive datetimes in UTC (GMT+0). */
  function parseOdooDt(raw) {
    if (!raw) return null;
    if (raw instanceof Date) return isNaN(raw) ? null : raw;
    const s = String(raw).trim();
    if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
      const d = new Date(s);
      return isNaN(d) ? null : d;
    }
    const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
    if (m) {
      const t = m[2].length === 5 ? m[2] + ":00" : m[2];
      const d = new Date(m[1] + "T" + t + "Z");
      return isNaN(d) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  /** Format instant as local PKT clock (12h). */
  function formatPktTime(raw) {
    const d = parseOdooDt(raw);
    if (!d) return "—";
    return d
      .toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: TZ,
      })
      .toLowerCase();
  }

  /** Monday 00:00 Asia/Karachi of the week containing `now`. */
  function weekMondayKey(now) {
    const key = dateKey(now);
    const [y, m, d] = key.split("-").map(Number);
    const noon = new Date(Date.UTC(y, m - 1, d, 7, 0, 0)); // ~12:00 PKT
    const wd = weekdayMon1(noon);
    const mon = new Date(noon);
    mon.setUTCDate(mon.getUTCDate() - (wd - 1));
    return dateKey(mon);
  }

  function addDaysKey(key, n) {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n, 7, 0, 0));
    return dateKey(dt);
  }

  /** Mon–Fri keys for the week of `now`. */
  function weekDayKeys(now) {
    const mon = weekMondayKey(now || new Date());
    return [0, 1, 2, 3, 4].map((i) => addDaysKey(mon, i));
  }

  /**
   * User leave time → { h, min } 24h PKT wall clock.
   * Bare "10:30" → 22:30 (PM). "22:30" / "10:30pm" / "10:30 am" also ok.
   */
  function parseUserTime(input) {
    const s = String(input)
      .trim()
      .toLowerCase()
      .replace(/\./g, "")
      .replace(/\s+/g, " ");
    const m = s.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
    if (!m) return null;
    let h = +m[1];
    const min = +m[2];
    const mer = m[3] || null;
    if (min > 59) return null;
    if (mer) {
      if (h < 1 || h > 12) return null;
      if (mer === "am") h = h === 12 ? 0 : h;
      else h = h === 12 ? 12 : h + 12;
    } else {
      if (h > 23) return null;
      // ponytail: bare 1–11 means PM (office leave times)
      if (h >= 1 && h <= 11) h += 12;
    }
    return { h: h, min: min, hhmm: pad(h) + ":" + pad(min) };
  }

  function parseTimeOnDay(dayKey, hhmm) {
    const s = String(hhmm).trim();
    // stored overrides are 24h "HH:MM" — don't run the leave-time PM heuristic
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (m && +m[1] <= 23 && +m[2] <= 59) {
      return new Date(
        dayKey + "T" + pad(+m[1]) + ":" + pad(+m[2]) + ":00+05:00"
      );
    }
    const t = parseUserTime(hhmm);
    if (!t) return null;
    return new Date(dayKey + "T" + t.hhmm + ":00+05:00");
  }

  function hoursBetween(a, b) {
    if (!a || !b) return null;
    const ms = b - a;
    if (ms <= 0) return null;
    return ms / 3600000;
  }

  function formatHours(h) {
    if (h == null || isNaN(h)) return "—";
    const sign = h < 0 ? "-" : "";
    const abs = Math.abs(h);
    const totalMin = Math.round(abs * 60);
    return sign + Math.floor(totalMin / 60) + ":" + pad(totalMin % 60);
  }

  /**
   * Resolve hours for one day.
   * @param {object} day - Odoo day record
   * @param {object|undefined} override - { leave } | { hours } | { holiday } | { start }
   */
  function dayHours(day, override) {
    // holiday wins over is_future / missing so Fri can be marked from Thu
    if (override && override.holiday) {
      return {
        hours: typeof override.hours === "number" ? override.hours : 0,
        status: "holiday",
      };
    }
    if (!day) return { hours: 0, status: "missing" };
    if (day.is_weekend) return { hours: 0, status: "weekend" };
    if (day.is_future) return { hours: 0, status: "future" };
    if (day.on_leave) return { hours: 0, status: "leave" };

    if (override && typeof override.hours === "number") {
      return { hours: override.hours, status: "manual" };
    }

    const checkIn = parseOdooDt(day.check_in);
    const checkOut = parseOdooDt(day.check_out);
    if (override && override.leave && checkIn) {
      // ponytail: drop leave override once Odoo has a real checkout (HR approval)
      if (!day.missing_checkout && checkOut) {
        /* fall through to Odoo hours */
      } else {
        const leave = parseTimeOnDay(dateKey(day.date || checkIn), override.leave);
        const h = hoursBetween(checkIn, leave);
        if (h != null) return { hours: h, status: "leave_time", checkIn, leave };
      }
    }

    if (day.missing_checkout && checkIn && !override) {
      return {
        hours: day.hours > 0 ? +day.hours : 0,
        status: "needs_leave",
        checkIn,
        leave: null,
      };
    }

    if (day.is_absent && !checkIn) {
      if (override && typeof override.hours === "number") {
        return { hours: override.hours, status: "manual" };
      }
      return { hours: 0, status: "needs_hours" };
    }

    if (day.hours != null && day.hours !== "") {
      return { hours: +day.hours, status: "ok", checkIn, leave: checkOut };
    }

    const h = hoursBetween(checkIn, checkOut);
    if (h != null) return { hours: h, status: "ok", checkIn, leave: checkOut };
    return { hours: 0, status: "unknown", checkIn, leave: checkOut };
  }

  function isSolid(d) {
    return (
      d.status === "ok" ||
      d.status === "leave_time" ||
      d.status === "manual" ||
      d.status === "holiday"
    );
  }

  /** Copy wall-clock PKT from `from` onto `dayKey`. */
  function sameClockOnDay(from, dayKey) {
    if (!from) return null;
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(from instanceof Date ? from : parseOdooDt(from));
    const get = (t) => parts.find((p) => p.type === t).value;
    return new Date(dayKey + "T" + get("hour") + ":" + get("minute") + ":00+05:00");
  }

  /** Default Fri start: latest Mon–Thu check-in clock, else 10:00am PKT. */
  function defaultStartFor(perDay, dayKey) {
    for (let i = perDay.length - 1; i >= 0; i--) {
      if (perDay[i].key === dayKey) continue;
      if (perDay[i].start) return sameClockOnDay(perDay[i].start, dayKey);
    }
    return new Date(dayKey + "T10:00:00+05:00");
  }

  /**
   * Project leave on remaining incomplete weekdays (today→Fri, always
   * including incomplete Thu/Fri) so solid + projected hits WEEK_TARGET.
   */
  function applyProjections(perDay, needed, todayWd) {
    if (needed <= 0) return;
    const from = Math.min(todayWd || 4, 4);
    const slots = perDay.filter(
      (d) => d.weekday >= from && d.weekday <= 5 && !isSolid(d)
    );
    if (!slots.length) return;
    const share = needed / slots.length;
    const tips = [];
    slots.forEach((d) => {
      if (!d.start) {
        d.start = defaultStartFor(perDay, d.key);
        d.startLabel = formatPktTime(d.start);
        d.startKind = "projected";
      }
      d.end = new Date(d.start.getTime() + share * 3600000);
      d.endLabel = formatPktTime(d.end);
      d.endKind = "projected";
      d.hours = share;
      d.status = "projected";
      tips.push(d.label + " leave " + d.endLabel);
    });
    return tips;
  }

  /**
   * @param {object[]} days - month day records from Odoo
   * @param {object} overrides - { "YYYY-MM-DD": { leave } | { hours } }
   * @param {Date} [now]
   * @param {number} [dailyHours] - 9 (default) or 6 → week target 45 or 30
   */
  function summarizeWeek(days, overrides, now, dailyHours) {
    now = now || new Date();
    overrides = overrides || {};
    const daily = +dailyHours === 6 ? 6 : 9;
    const keys = weekDayKeys(now);
    const byKey = {};
    (days || []).forEach((d) => {
      const k = dateKey(parseDayDate(d.date) || d.date);
      byKey[k] = d;
    });

    const perDay = keys.map((key, i) => {
      const day = byKey[key];
      const o = overrides[key];
      const resolved = dayHours(day, o);
      const holiday = resolved.status === "holiday";
      if (holiday) resolved.hours = 0;
      const names = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      let start = holiday
        ? null
        : resolved.checkIn || parseOdooDt(day && day.check_in);
      let startKind = start ? "actual" : "";
      if (!holiday && !start && o && o.start) {
        start = parseTimeOnDay(key, o.start);
        if (start) startKind = "entered";
      }
      const end = holiday
        ? null
        : resolved.leave ||
          (resolved.status === "leave_time"
            ? null
            : parseOdooDt(day && day.check_out));
      let endKind = "";
      if (resolved.status === "leave_time" && end) endKind = "entered";
      else if (end) endKind = "actual";
      return {
        key,
        label: names[i],
        weekday: i + 1,
        hours: resolved.hours || 0,
        status: resolved.status,
        checkIn: day && day.check_in,
        checkOut: day && day.check_out,
        start: start,
        end: end,
        startLabel: formatPktTime(start),
        endLabel: formatPktTime(end),
        startKind: startKind,
        endKind: endKind,
        missing_checkout: !!(day && day.missing_checkout),
        is_absent: !!(day && day.is_absent),
        needsInput:
          resolved.status === "needs_leave" ||
          resolved.status === "needs_hours",
      };
    });

    // ponytail: incomplete days don't count toward banked — projection fills Thu/Fri
    const holidayCount = perDay.filter((d) => d.status === "holiday").length;
    const weekTarget = daily * (5 - holidayCount);
    const banked = perDay.reduce(
      (s, d) => s + (isSolid(d) ? d.hours || 0 : 0),
      0
    );
    const needed = Math.max(0, weekTarget - banked);
    const todayKey = dateKey(now);
    const todayWd = weekdayMon1(now);
    const tips = applyProjections(perDay, needed, todayWd) || [];

    // pace vs completed days only (both check-in + check-out / entered leave / manual)
    const doneCount = perDay.filter(
      (d) =>
        d.status === "ok" ||
        d.status === "leave_time" ||
        d.status === "manual"
    ).length;
    const expectedByToday = daily * doneCount;
    const vsToday = banked - expectedByToday;

    let focus =
      "Banked " + formatHours(banked) + " · Need " + formatHours(needed) + " by Friday";
    if (needed <= 0) {
      focus = "Week target met (" + weekTarget + "h)";
    } else if (tips.length) {
      focus = tips.join(" · ") + " (to hit " + weekTarget + "h)";
    }

    return {
      weekStart: keys[0],
      banked,
      needed,
      target: weekTarget,
      dailyHours: daily,
      expectedByToday,
      vsToday,
      todayKey,
      todayWd,
      perDay,
      focus,
      formatHours,
    };
  }

  root.ShelfIndex = {
    WEEK_TARGET,
    weekTargetForDaily,
    TZ,
    DASHBOARD_URL,
    dateKey,
    weekdayMon1,
    weekDayKeys,
    weekMondayKey,
    parseOdooDt,
    formatPktTime,
    parseUserTime,
    parseTimeOnDay,
    hoursBetween,
    formatHours,
    dayHours,
    summarizeWeek,
    parseDayDate,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
