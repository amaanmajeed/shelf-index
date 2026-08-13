#!/usr/bin/env node
/** Runnable self-check for week remaining math. */
const path = require("path");
require(path.join(__dirname, "hours.js"));
const OH = globalThis.ShelfIndex;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Fixed "now": Friday 2026-08-07 in PKT
const now = new Date("2026-08-07T12:00:00+05:00");
const keys = OH.weekDayKeys(now);
assert(keys[0] === "2026-08-03", "week should start Mon 2026-08-03, got " + keys[0]);
assert(keys[4] === "2026-08-07", "week should end Fri 2026-08-07, got " + keys[4]);

assert(OH.formatPktTime("2026-08-05 09:08:00") === "2:08 pm", "UTC 09:08 → 2:08 pm PKT");

const t1 = OH.parseUserTime("10:30");
assert(t1 && t1.hhmm === "22:30", "bare 10:30 → 22:30, got " + (t1 && t1.hhmm));
assert(OH.parseUserTime("22:30").hhmm === "22:30", "22:30 stays");
assert(OH.parseUserTime("10:30pm").hhmm === "22:30", "10:30pm");
assert(OH.parseUserTime("10:30 am").hhmm === "10:30", "10:30 am");

// Mon–Wed solid, Thu missing out, Fri check-in only
const days = [
  { date: "2026-08-03", hours: 9, check_in: "2026-08-03 05:00:00", check_out: "2026-08-03 14:00:00" },
  { date: "2026-08-04", hours: 9, check_in: "2026-08-04 05:00:00", check_out: "2026-08-04 14:00:00" },
  { date: "2026-08-05", hours: 9, check_in: "2026-08-05 05:00:00", check_out: "2026-08-05 14:00:00" },
  { date: "2026-08-06", hours: 0, check_in: "2026-08-06 05:00:00", check_out: null, missing_checkout: true },
  { date: "2026-08-07", hours: 0, check_in: "2026-08-07 05:00:00", check_out: null, missing_checkout: true },
];

let summary = OH.summarizeWeek(days, {}, now);
// solid banked = 27, need 18 over Thu+Fri → 9h each
assert(Math.abs(summary.banked - 27) < 0.01, "banked 27, got " + summary.banked);
assert(Math.abs(summary.needed - 18) < 0.01, "needed 18, got " + summary.needed);
const thu = summary.perDay.find((d) => d.label === "Thu");
const fri = summary.perDay.find((d) => d.label === "Fri");
assert(thu.status === "projected", "Thu projected, got " + thu.status);
assert(fri.status === "projected", "Fri projected, got " + fri.status);
assert(thu.endKind === "projected", "Thu end yellow");
assert(fri.endKind === "projected", "Fri end yellow");
assert(Math.abs(thu.hours - 9) < 0.01, "Thu 9h share");
assert(Math.abs(fri.hours - 9) < 0.01, "Fri 9h share");
assert(thu.endLabel === "7:00 pm", "Thu leave 7pm from 10am+9h, got " + thu.endLabel);
assert(fri.endLabel === "7:00 pm", "Fri leave 7pm, got " + fri.endLabel);

// Thu entered leave → green; Fri gets the rest
summary = OH.summarizeWeek(
  days,
  { "2026-08-06": { leave: "18:00" } },
  now
);
const thu2 = summary.perDay.find((d) => d.label === "Thu");
const fri2 = summary.perDay.find((d) => d.label === "Fri");
assert(thu2.status === "leave_time", "Thu entered");
assert(thu2.endKind === "entered", "Thu end green");
assert(thu2.endLabel === "6:00 pm", "Thu entered 6pm, got " + thu2.endLabel);
// banked = 27 + 8 = 35, need 10 on Fri
assert(Math.abs(summary.banked - 35) < 0.01, "banked 35, got " + summary.banked);
assert(fri2.status === "projected", "Fri still projected");
assert(Math.abs(fri2.hours - 10) < 0.01, "Fri gets remaining 10h, got " + fri2.hours);
assert(fri2.endLabel === "8:00 pm", "Fri leave 8pm, got " + fri2.endLabel);

// Thu complete from Odoo, Fri no check-in → project Fri start+end
const days2 = [
  { date: "2026-08-03", hours: 9, check_in: "2026-08-03 05:00:00", check_out: "2026-08-03 14:00:00" },
  { date: "2026-08-04", hours: 9, check_in: "2026-08-04 05:00:00", check_out: "2026-08-04 14:00:00" },
  { date: "2026-08-05", hours: 9, check_in: "2026-08-05 05:00:00", check_out: "2026-08-05 14:00:00" },
  { date: "2026-08-06", hours: 9, check_in: "2026-08-06 05:00:00", check_out: "2026-08-06 14:00:00" },
  { date: "2026-08-07", hours: 0, check_in: null, check_out: null, is_absent: true },
];
summary = OH.summarizeWeek(days2, {}, now);
const fri3 = summary.perDay.find((d) => d.label === "Fri");
assert(fri3.status === "projected", "Fri projected when absent");
assert(fri3.startKind === "projected", "Fri start yellow");
assert(fri3.endKind === "projected", "Fri end yellow");
assert(fri3.startLabel === "10:00 am", "Fri start mirrors Thu, got " + fri3.startLabel);
assert(Math.abs(fri3.hours - 9) < 0.01, "Fri needs 9h (36 banked), got " + fri3.hours);
assert(fri3.endLabel === "7:00 pm", "Fri leave 7pm, got " + fri3.endLabel);

// 6h/day → 30h week; Mon–Wed 6h each = 18 banked, need 12 over Thu+Fri
const days6 = [
  { date: "2026-08-03", hours: 6, check_in: "2026-08-03 05:00:00", check_out: "2026-08-03 11:00:00" },
  { date: "2026-08-04", hours: 6, check_in: "2026-08-04 05:00:00", check_out: "2026-08-04 11:00:00" },
  { date: "2026-08-05", hours: 6, check_in: "2026-08-05 05:00:00", check_out: "2026-08-05 11:00:00" },
  { date: "2026-08-06", hours: 0, check_in: "2026-08-06 05:00:00", check_out: null, missing_checkout: true },
  { date: "2026-08-07", hours: 0, check_in: "2026-08-07 05:00:00", check_out: null, missing_checkout: true },
];
summary = OH.summarizeWeek(days6, {}, now, 6);
assert(summary.target === 30, "6h/day week target 30");
assert(Math.abs(summary.needed - 12) < 0.01, "need 12, got " + summary.needed);
assert(Math.abs(summary.perDay.find((d) => d.label === "Thu").hours - 6) < 0.01, "Thu 6h share");

// Holiday on absent Fri drops week target (36h), does not bank hours
summary = OH.summarizeWeek(
  days2,
  { "2026-08-07": { holiday: true, hours: 9 } },
  now
);
const friH = summary.perDay.find((d) => d.label === "Fri");
assert(friH.status === "holiday", "Fri holiday, got " + friH.status);
assert(friH.hours === 0, "holiday hours 0, got " + friH.hours);
assert(summary.target === 36, "1 holiday → 36h target, got " + summary.target);
assert(Math.abs(summary.banked - 36) < 0.01, "banked 36 (no holiday credit), got " + summary.banked);
assert(summary.needed === 0, "week met after holiday");
assert(!friH.start && !friH.end, "holiday row has no start/end");

// Thu now, Fri is_future — holiday must stick (not get projected)
const thuNow = new Date("2026-08-06T12:00:00+05:00");
const daysThu = [
  { date: "2026-08-03", hours: 9, check_in: "2026-08-03 05:00:00", check_out: "2026-08-03 14:00:00" },
  { date: "2026-08-04", hours: 9, check_in: "2026-08-04 05:00:00", check_out: "2026-08-04 14:00:00" },
  { date: "2026-08-05", hours: 9, check_in: "2026-08-05 05:00:00", check_out: "2026-08-05 14:00:00" },
  { date: "2026-08-06", hours: 9, check_in: "2026-08-06 05:00:00", check_out: "2026-08-06 14:00:00" },
  { date: "2026-08-07", hours: 0, check_in: null, check_out: null, is_future: true },
];
summary = OH.summarizeWeek(daysThu, { "2026-08-07": { holiday: true } }, thuNow);
const friFut = summary.perDay.find((d) => d.label === "Fri");
assert(friFut.status === "holiday", "future Fri holiday, got " + friFut.status);
assert(friFut.hours === 0, "holiday hours 0, got " + friFut.hours);
assert(!friFut.start && !friFut.end, "holiday has no start/end");
assert(summary.target === 36, "future holiday → 36h, got " + summary.target);
assert(Math.abs(summary.banked - 36) < 0.01, "banked 36, got " + summary.banked);

summary = OH.summarizeWeek(daysThu, { "2026-08-07": { holiday: true } }, thuNow, 6);
assert(summary.target === 24, "6h/day + 1 holiday → 24h, got " + summary.target);
assert(summary.perDay.find((d) => d.label === "Fri").hours === 0, "holiday hours stay 0");

// Wed still clocked in — project today+Thu+Fri, don't treat as a gap to fill
const wedNow = new Date("2026-08-05T12:00:00+05:00");
const daysWed = [
  { date: "2026-08-03", hours: 9, check_in: "2026-08-03 05:00:00", check_out: "2026-08-03 14:00:00" },
  { date: "2026-08-04", hours: 9, check_in: "2026-08-04 05:00:00", check_out: "2026-08-04 14:00:00" },
  { date: "2026-08-05", hours: 0, check_in: "2026-08-05 05:00:00", check_out: null, missing_checkout: true },
  { date: "2026-08-06", hours: 0, check_in: null, check_out: null, is_future: true },
  { date: "2026-08-07", hours: 0, check_in: null, check_out: null, is_future: true },
];
summary = OH.summarizeWeek(daysWed, {}, wedNow);
assert(Math.abs(summary.banked - 18) < 0.01, "Wed-now banked 18, got " + summary.banked);
const wed = summary.perDay.find((d) => d.label === "Wed");
assert(wed.status === "projected", "Wed projected while clocked in, got " + wed.status);
assert(Math.abs(wed.hours - 9) < 0.01, "Wed 9h share, got " + wed.hours);
assert(wed.endLabel === "7:00 pm", "Wed leave 7pm, got " + wed.endLabel);
assert(wed.endKind === "projected", "Wed end yellow");

// Fri start override → entered start, leave computed from remaining
summary = OH.summarizeWeek(daysThu, { "2026-08-07": { start: "11:00" } }, thuNow);
const friS = summary.perDay.find((d) => d.label === "Fri");
assert(friS.startKind === "entered", "Fri start entered, got " + friS.startKind);
assert(friS.startLabel === "11:00 am", "Fri start 11am, got " + friS.startLabel);
assert(friS.status === "projected", "Fri still projected, got " + friS.status);
assert(Math.abs(friS.hours - 9) < 0.01, "Fri 9h remaining, got " + friS.hours);
assert(friS.endLabel === "8:00 pm", "Fri leave 8pm from 11am+9h, got " + friS.endLabel);

console.log("ok — projections:", summary.focus);
