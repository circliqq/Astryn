# GasWarMode — UI Redesign Prompt

## What this prompt does
Restyle **all pages** of the GasWarMode web app so the UI looks like a professional internal
operations tool (think: Linear, Railway, Resend, Vercel dashboard, Turso console).
**No functional changes. No category/feature changes. No route changes.**
Only CSS, Tailwind classes, and component markup are allowed to change.

---

## The core problem to fix

The current UI has these "AI-generated / Behance concept" signals that must be removed:

- Colored glow box-shadows on buttons and cards (e.g. `0 4px 10px rgba(255,107,53,0.55)`)
- Rotating conic gradients and animated rings
- Radial gradient body background (`radial-gradient(circle at 80%...`)
- Multi-color gradient fills on panel backgrounds
- Too many simultaneous accent colors (orange + cyan + emerald + amber + red + blue all at once)
- `rgba(255,255,255,0.06)` ghost borders that fade into nothing — borders need to be visible
- Negative letter-spacing on body text (`-0.018em`) — only use on display headings
- Glowing text shadows
- `backdrop-filter: blur` on every surface

---

## New design language — rules to follow exactly

### 1. Color system

Use this palette. Do not introduce any other colors.

```
Background base:      #0C0E12   (near-black, no blue tint)
Surface 1 (cards):    #111318   (slightly lighter)
Surface 2 (inputs):   #181B21   (for inputs, code, table rows)
Border:               #252830   (visible but quiet — use on all borders)
Border strong:        #333740   (use on active/focused elements)

Text primary:         #F0F2F5
Text secondary:       #8B90A0
Text muted:           #555B6A

Accent (brand):       #FF6B35   (use ONLY for: primary CTA button, active nav item, key metric highlight)
Accent hover:         #E85A25

Status green:         #22863A   (bg) / #3FB950 (text/icon)  — healthy, ready, confirmed
Status yellow:        #9E6A03   (bg) / #D29922 (text/icon)  — warning, scheduled, pending
Status red:           #8B1A1A   (bg) / #F85149 (text/icon)  — failed, error, critical
Status blue:          #1158AE   (bg) / #58A6FF (text/icon)  — running, info
Status neutral:       #2A2D35   (bg) / #8B90A0 (text)       — draft, disabled, muted
```

### 2. Typography

```
Font: Inter (already installed)
Mono: JetBrains Mono (already installed)

Display (page title h1):    18px / font-semibold / tracking: -0.01em / color: text-primary
Section heading (h2, h3):   13px / font-semibold / tracking: 0 / color: text-primary
Label / caption:            11px / font-medium / tracking: 0.04em / UPPERCASE / color: text-muted
Body text:                  13px / font-normal / tracking: 0 / color: text-secondary
Table cell:                 13px / font-normal / color: text-primary
Mono (addresses, IDs):      12px / JetBrains Mono / color: text-secondary
Number (big metric):        28px / font-semibold / tabular-nums / color: text-primary
```

No gradient text. No text-shadow. No glow on text.

### 3. Surfaces and borders

Every card/panel:
```css
background: #111318;
border: 1px solid #252830;
border-radius: 8px;
box-shadow: none;   /* NO shadow on cards */
```

No `linear-gradient` on card backgrounds. No `backdrop-filter: blur` except on the sticky
header (one place only, `backdrop-filter: blur(8px)` is fine there).

Inputs and select:
```css
background: #181B21;
border: 1px solid #252830;
border-radius: 6px;
/* focus: border-color: #FF6B35; box-shadow: 0 0 0 2px rgba(255,107,53,0.15); */
```

### 4. Buttons

Primary button (one per section, used for the main action):
```css
background: #FF6B35;
color: #fff;
border-radius: 6px;
font-size: 13px; font-weight: 600;
padding: 0 14px; height: 32px;
box-shadow: none;   /* NO colored glow */
hover: background: #E85A25;
```

Secondary button:
```css
background: transparent;
border: 1px solid #333740;
color: #F0F2F5;
border-radius: 6px;
height: 32px;
hover: background: #181B21;
```

Ghost / icon button:
```css
background: transparent;
color: #8B90A0;
border-radius: 6px;
hover: background: #181B21; color: #F0F2F5;
```

Danger button:
```css
background: transparent;
border: 1px solid rgba(248,81,73,0.3);
color: #F85149;
hover: background: rgba(248,81,73,0.08);
```

**Never use colored glow box-shadow on buttons.**

### 5. Badges / status pills

Status is shown as a small inline badge: colored background + matching text.
No border. No shadow. No animation.

```
Ready / Confirmed:  bg #0D2B17  text #3FB950
Running / Scheduled: bg #0D1F40 text #58A6FF
Failed / Error:     bg #2D0F0F  text #F85149
Paused / Warning:   bg #2B1D03  text #D29922
Draft / Disabled:   bg #1E2028  text #8B90A0
```

Pill shape: `border-radius: 4px; padding: 1px 6px; font-size: 11px; font-weight: 500;`

### 6. Table design

Tables are the main UI pattern in this app. Make them look like proper data tables:

```
Table background:           transparent
Header row background:      transparent
Header cell text:           11px / UPPERCASE / font-medium / text-muted / letter-spacing: 0.04em
Header border-bottom:       1px solid #252830
Row border-bottom:          1px solid #1A1D24  (lighter than card border)
Row hover background:       #141720
Cell padding:               10px 16px
No zebra striping
No rounded rows
No card-wrapping individual rows
```

### 7. Sidebar

```
Width: 240px
Background: #0C0E12  (same as page bg — no visual separation needed, use border-right)
Border-right: 1px solid #252830

Brand logo area: padding 16px 16px 12px
Nav section label: 10px / UPPERCASE / font-medium / letter-spacing: 0.06em / color: #555B6A / padding: 0 12px / margin-top: 20px
Nav item: 13px / padding: 6px 10px / border-radius: 5px / color: #8B90A0
Nav item hover: background: #181B21 / color: #F0F2F5
Nav item active: background: #1C1F27 / color: #FF6B35 / left border: 2px solid #FF6B35
  (NOT background fill with accent color — just a left-border indicator)
Nav item icon: 15px, same color as text
```

No glow on active state. No animated indicators.

### 8. Header

```
Height: 48px
Background: rgba(12,14,18,0.92)
Border-bottom: 1px solid #252830
backdrop-filter: blur(8px)   ← only allowed blur in the whole app

Page title: 15px / font-semibold / color: text-primary
Right side: live status indicators (plain text, no badges unless status is bad)
```

### 9. Live status bar (in header, right side)

Plain text with a small dot indicator. No animated pulses.
Example: `● RPC 3/3  ·  Wallets 80%  ·  Gas 4.2 gwei`

- Green dot `#3FB950` = healthy
- Yellow dot `#D29922` = warning  
- Red dot `#F85149` = critical
- Dot size: 6px circle, `display: inline-block`

### 10. Metric cards (dashboard top row)

```
Background: #111318
Border: 1px solid #252830
Border-radius: 8px
Padding: 16px
Box-shadow: none

Label: 11px / UPPERCASE / font-medium / letter-spacing: 0.04em / color: text-muted
Value: 28px / font-semibold / tabular-nums / color: text-primary / margin-top: 6px
Delta text: 12px / color: text-muted / margin-top: 2px
```

No colored backgrounds on metric cards. No gradient fills. No glow.
The accent color (`#FF6B35`) is allowed ONLY on the delta text if it's a "key" metric.

### 11. Charts (gas sparkline)

```
Line color: #FF6B35 / stroke-width: 1.5
Area fill: linear-gradient from rgba(255,107,53,0.15) to transparent
Background: transparent (chart sits directly on card surface)
Axis labels: 11px / text-muted / no gridlines (or very subtle #1A1D24 horizontal lines only)
Current-price dot: 4px solid circle #FF6B35
No animated elements
```

### 12. Form inputs

All inputs, selects, textareas follow the same style:
```
background: #181B21
border: 1px solid #252830
border-radius: 6px
color: #F0F2F5
font-size: 13px
padding: 0 10px
height: 32px
placeholder color: #555B6A
focus: border-color: #FF6B35; outline: none; box-shadow: 0 0 0 2px rgba(255,107,53,0.12)
```

### 13. Modals / dialogs

```
Backdrop: rgba(0,0,0,0.7)
Panel: background #111318; border: 1px solid #333740; border-radius: 10px; padding: 20px
Max-width: 480px
No blur on the modal panel itself
Title: 15px / font-semibold
Close button: top-right, ghost style, X icon
```

### 14. Action Center (dashboard quick-actions)

Four action buttons in a row. Each is a flat card:
```
Background: #111318
Border: 1px solid #252830
Border-radius: 8px
Padding: 14px
Hover: border-color: #333740; background: #141720
NO colored glow on hover
Icon container: 28px square, border-radius: 6px, bg: rgba(255,107,53,0.10), color: #FF6B35
  (only "Start Mint" gets the orange icon — others use text-muted icon on #1E2028 bg)
Label: 13px / font-medium / color: text-primary
Sublabel: 12px / color: text-muted
```

### 15. Task timeline / progress stepper

Horizontal stepper inside each table row:
```
Step dot: 16px circle
  - completed: bg #0D2B17; color #3FB950; border: 1px solid #22863A
  - active: bg #0D1F40; color #58A6FF; border: 1px solid #1158AE
  - failed: bg #2D0F0F; color #F85149; border: 1px solid #8B1A1A
  - pending: bg #1E2028; color #555B6A; border: 1px solid #252830
Connector line: 16px wide, 1px tall
  - completed: #22863A
  - pending: #252830
Step font: 9px monospace, font-weight: 700
```

Retry button: secondary style, 11px text, `RotateCcw` icon 11px.

### 16. ReadinessRing

```
Ring track: #1E2028
Ring arc: color based on score threshold
  ≥80: #3FB950 (green)
  ≥50: #D29922 (yellow)
  <50: #F85149 (red)
Centre score text: 32px / font-semibold / color: text-primary
Centre label text: 12px / color: text-muted (just show the percentage word, not "Good"/"Fair"/"Poor")
Click hint: "inspect →" in 11px text-muted below the ring
No glow shadow around the ring
```

### 17. Empty states

Consistent pattern across all pages:
```
Icon: 32px / text-muted, inside a 52px circle with bg #1E2028
Title: 13px / font-medium / color: text-primary / margin-top: 12px
Subtitle: 12px / color: text-muted / margin-top: 4px
CTA button (if any): primary or secondary style / margin-top: 16px
```

Container: `display: flex; flex-direction: column; align-items: center; padding: 48px 24px; text-align: center`

---

## Page-by-page application

Apply the design language above to every page. The same component always looks
the same regardless of which page it appears on. Specifically:

**Dashboard** — ActionCenter, MetricCards, ReadinessRing, GasChart, RPCHealth, TaskTimeline
**Wallet Vault** — WalletTable, search input, status filter select, import/create buttons
**Scanner** — search form, collection cards/list, chain filter
**Mint Tasks** — task list table, create button, status filter, task detail
**Gas Settings** — form fields, mode selector (safe/balanced/aggressive), save button
**Funding Assistant** — wallet list, amount inputs, send button, funding history
**ETH Distributor** — address inputs, amount field, distribution table
**Reports** — stat cards, date range picker, any charts
**RPC Health** — endpoint list, latency numbers, status indicators, add-endpoint form
**Live Logs** — terminal area (keep `.terminal` class: `#070b12` bg, `#8dffbc` text, JetBrains Mono), filter controls above it
**Settings** — form sections, toggle switches, save buttons, section dividers
**Admin Panel** — user table, action buttons, any admin-specific controls

---

## What to explicitly remove / not add

| Remove | Replace with |
|--------|-------------|
| `radial-gradient(circle at X% Y%...)` on body | flat `#0C0E12` background |
| `box-shadow: 0 0 Xpx rgba(color, 0.5)` colored glows | no shadow, or `0 1px 3px rgba(0,0,0,0.3)` only |
| `conic-gradient(...)` animated ring | static SVG ring (ReadinessRing) |
| `linear-gradient(...)` on panel/card backgrounds | flat `#111318` |
| `backdrop-filter: blur` on cards | remove (keep only on sticky header) |
| Multiple accent colors used simultaneously | one accent `#FF6B35` per section max |
| `animate-pulse` on anything except loading skeletons | remove |
| Negative letter-spacing on body/caption text | 0 or positive only |
| Gradient text (`background-clip: text`) | plain colored text |
| Shadow text (`text-shadow: 0 0 18px...`) | remove |
| `rgba(255,255,255,0.06)` barely-visible borders | `#252830` solid border |

---

## Globals.css final state

```css
:root {
  color-scheme: dark;
}

html {
  background: #0C0E12;
}

body {
  min-height: 100vh;
  margin: 0;
  background: #0C0E12;   /* flat — NO radial gradient */
  color: #F0F2F5;
  font-family: Inter, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

* { box-sizing: border-box; }

button, input, select, textarea { font: inherit; }

.panel {
  background: #111318;
  border: 1px solid #252830;
  border-radius: 8px;
}

.terminal {
  font-family: "JetBrains Mono", ui-monospace, monospace;
  background: #070b12;
  color: #8dffbc;
  font-size: 12px;
  line-height: 1.6;
}

.focus-ring { outline: 2px solid transparent; outline-offset: 2px; }
.focus-ring:focus-visible { outline-color: #FF6B35; }

/* Sidebar active indicator */
.nav-active {
  border-left: 2px solid #FF6B35;
  padding-left: 8px !important;
  background: #1C1F27;
  color: #FF6B35 !important;
}

/* Mobile sidebar backdrop */
.sidebar-backdrop { background: rgba(0,0,0,0.7); }

/* Wallet privacy toggles */
[data-wallet-address], [data-wallet-balance] {
  transition: filter 160ms ease, opacity 160ms ease;
}
:root[data-hide-wallet-addresses="true"] [data-wallet-address],
:root[data-blur-balances="true"] [data-wallet-balance] {
  filter: blur(5px);
  opacity: 0.7;
  user-select: none;
}
```

---

## Tailwind config final state

```ts
colors: {
  graphite: {
    950: "#0C0E12",
    900: "#111318",
    800: "#181B21",
    700: "#252830",
    600: "#333740",
  },
  brand: "#FF6B35",
  "brand-hover": "#E85A25",
}
```

Remove `emerald.signal`, `cyan.signal`, `fire.*` custom colors.
The Tailwind `emerald`, `cyan`, `amber`, `red`, `slate` scales remain available
**but are only used for their named status meanings** (green=healthy, yellow=warning, etc.)
**and not mixed freely** across the UI.

---

## Implementation checklist

For each file changed, verify:
- [ ] No `box-shadow` with color other than `rgba(0,0,0,X)`
- [ ] No `background: linear-gradient(...)` on panels or body
- [ ] No `text-shadow` or `filter: drop-shadow` on text
- [ ] All borders use `#252830` or Tailwind equivalent (`border-slate-800` is too dark, `border-slate-700` is close enough as fallback)
- [ ] Accent color `#FF6B35` / `text-orange-400` appears max once per visual section
- [ ] Buttons have `height: 32px` consistently (not `h-10` = 40px which is too large for a dense tool UI)
- [ ] Table header cells are UPPERCASE 11px
- [ ] Status badges follow the color map above (no free-form tone choices)
- [ ] No `animate-pulse` except on loading skeleton placeholders
- [ ] Mobile sidebar uses flat `#111318` background (no gradient)

---

## Reference: what this should look like

If the finished UI were a screenshot, it would look like a mix of:
- **Linear** (task list density, clean typography, subtle borders)
- **Railway** (dark tool dashboard, metric cards without chrome)
- **Vercel dashboard** (consistent spacing, one accent, no glow)
- **GitHub dark mode** (status colors, tables, readable without eye strain)

It should NOT look like a crypto project landing page, a Figma component library
demo, a Discord server theme, or any AI image generation UI.
