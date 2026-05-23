# Nozomi Summary

> Transform Nozomi Networks Vantage alert export (`.xlsx`) into a clean, formatted Excel summary — entirely in your browser.

Built for the **PTTEP SOC OT** team. No server, no uploads, no installation required.

---

## What It Does

Takes a raw Nozomi Vantage export (54 columns, `Vantage export` sheet) and outputs a formatted Excel file with:

- **15 key columns** in the correct order: `id`, `time`, `name`, `type_id`, `description`, `risk`, `ip_src`, `ip_dst`, `mac_src`, `mac_dst`, `port_dst`, `port_src`, `protocol`, `transport_protocol`, `site:name`
- **Shift-coded header row**: orange (`#E97132`) for Day shift, dark teal (`#17375E`) for Night shift — white bold text
- **Alternating striped rows** for readability
- **Calibri 11pt** throughout
- **Sheet name** `Alert_<day>` (e.g. `Alert_23` for the 23rd)
- **Output filename** `Nozomi_Summary_YYYY-MM-DD_<Shift>.xlsx`

---

## How to Use

1. **Open the app** — either at the hosted URL or by opening `index.html` directly in your browser
2. **Drop your Nozomi export** — drag and drop the `export_alert_*.xlsx` file onto the drop zone, or click to browse
3. **Select the shift** — click **Day** or **Night** (☀️ / 🌙)
4. **Check the preview** — the app shows the first 5 rows of key columns so you can verify it's the right file
5. **Click "Transform & Download"** — the formatted Excel file downloads automatically
6. **Transform Another** — click the button to start over for the next shift

### Supported Input Format

| Requirement | Detail |
|---|---|
| File type | `.xlsx` only |
| Sheet name | Must contain a sheet named **`Vantage export`** |
| Required columns | All 15 KEEP_COLUMNS must be present |
| Row count | At least 1 data row |

---

## Privacy

**Your files never leave your device.**

- The file is read using the browser's `FileReader` API — no upload occurs
- All processing runs in browser memory (JavaScript)
- After the download triggers, the source buffer is set to `null` so the garbage collector reclaims it
- There are **zero network requests** to any server during transform
- No cookies, no localStorage, no analytics

---

## Deploy to Vercel

### Step 1 — Create a GitHub repository

```bash
git init
git add .
git commit -m "initial commit"
# Create a new private repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/nozomi-summary.git
git push -u origin main
```

### Step 2 — Import into Vercel

1. Go to [vercel.com](https://vercel.com) and log in
2. Click **"Add New Project"**
3. Click **"Import Git Repository"** and select `nozomi-summary`
4. Vercel automatically detects it as a static site — no build config needed
5. Click **"Deploy"**

### Step 3 — Share the URL

Vercel gives you a URL like `https://nozomi-summary.vercel.app`. Share it with the SOC OT team.

Every `git push` to `main` automatically redeploys.

> **Private repo on Vercel**: Vercel's free Hobby plan supports private GitHub repos. Your code is never public — only the deployed site URL is accessible.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Markup | HTML5 (semantic, accessible) |
| Style | Vanilla CSS (custom properties, dark theme, CSS animations) |
| Logic | Vanilla JavaScript ES2020 (no frameworks, no build tools) |
| Excel engine | [SheetJS CE](https://sheetjs.com/) via CDN (`xlsx@0.18.5`) |
| Font | [Inter](https://fonts.google.com/specimen/Inter) via Google Fonts |
| Hosting | [Vercel](https://vercel.com) (static site, auto-deploy) |

---

## Files

```
nozomi-summary/
├── index.html   — Single-page app (all UI states)
├── style.css    — Dark theme, animations, responsive layout
├── app.js       — Transform engine + FileReader + SheetJS integration
└── README.md    — This file
```

---

## Column Reference

| # | Column | Excel Width |
|---|---|---|
| 1 | `id` | 41 |
| 2 | `time` | 27 |
| 3 | `name` | 30 |
| 4 | `type_id` | 32 |
| 5 | `description` | 104 |
| 6 | `risk` | 9 |
| 7 | `ip_src` | 16 |
| 8 | `ip_dst` | 17 |
| 9 | `mac_src` | 18 |
| 10 | `mac_dst` | 10 |
| 11 | `port_dst` | 12 |
| 12 | `port_src` | 11 |
| 13 | `protocol` | 11 |
| 14 | `transport_protocol` | 22 |
| 15 | `site:name` | 13 |

---

## Known Limitations

| Item | Detail |
|---|---|
| Cell colours | Requires SheetJS CE 0.18.x; colour output depends on SheetJS CE style support. Data is always correctly transformed even if colours are absent. |
| Excel Named Tables | SheetJS CE does not support formal Excel Table objects (`TableStyleLight10`/9) — header colours are applied as manual cell fills instead, which produces the same visual result. |
| Very large files | Browser memory caps apply (~500 MB+), but typical Nozomi exports are under 10 MB. |
| Fonts | Calibri is specified in the output. If not installed on the viewer's machine, Excel substitutes the default font. |

---

*Part of the Mr.Robot SOC OT Automation project — PTTEP*
