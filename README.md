# Shelf Index

Chrome extension that tallies your weekly work hours on the CodingCops Odoo workspace (`odoo.codingcops.com`).

Shows banked hours vs the week target (45h at 9h/day, or 30h at 6h/day), projects leave times for incomplete Thu/Fri, and lets you fill gaps when Odoo is missing a checkout or a full day.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this folder
4. Sign in to Odoo, open the attendance/workspace page, then click the clock icon in the navbar (or use the extension popup → **Refresh index**)

Reload the Odoo tab after updating the extension.

## Usage

| Action | When |
| --- | --- |
| Enter leave time | Checkout missing but check-in exists |
| Enter hours | Day absent / no check-in |
| **Holiday** | Both check-in and check-out missing — banks a full daily target |
| 9h / 6h toggle | Switch week target (45h or 30h) |

Friday leave is projected from remaining hours; you don’t enter it manually.

Overrides (leave time, manual hours, holiday) are stored locally in the extension.

## Check

```bash
node check.js
```
