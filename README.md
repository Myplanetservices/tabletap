# TableTap

QR table-ordering for restaurants, bars and cafés. A guest scans the code on the table, the menu
opens in their browser, they order, and the ticket lands on a screen at the kitchen pass.

This repository is a **fully clickable demo**: plain HTML, CSS and vanilla ES modules, with all
data seeded into the browser (`localStorage`, key `tqr_db`). There is no backend — "live" means
`BroadcastChannel` between tabs on the same machine.

## Recent Improvements & Added Features
1. **Google Sheets Sync (`ensureSheetsExist`)**:
   - Live two-way sync for orders, menu catalog, table status, and daily revenue reports.
   - Automatically provisions missing sheets/tabs (`Orders`, `Menu`, `Tables`, `Reports`, `Meta`) on any newly connected Google Spreadsheet.
2. **Google Drive Cloud Backup (Resumable Uploads)**:
   - Resumable Google Drive upload session for database backups and receipts with progress tracking.
3. **Drag & Drop Photo Uploader**:
   - Menu item photo uploader supports drag-and-drop with auto-resizing to 800px on the fly.
4. **Dark Mode & System Theme Switcher**:
   - Theme toggle button with Sun / Moon icon across all screens (Owner panel, Kitchen pass, Admin panel, Customer menu toolbar) with auto-matching system preferences and `localStorage` persistence (`tqr_theme`).
5. **Netlify Production Ready**:
   - Includes `_redirects` and optimized `netlify.toml` for seamless static hosting and zero 404s on browser reloads.

## Architecture & Deployment

### 1. Vercel Production Deployment
This repository is configured out-of-the-box for **Vercel** (`vercel.json`, `package.json`, serverless `/api` routes):
1. Import or push this repo to GitHub / GitLab / Bitbucket.
2. In Vercel, click **New Project** and select this repository.
3. In **Project Settings → Environment Variables**, add your MongoDB cluster connection string:
   - `MONGODB_URI` = `mongodb+srv://<username>:<password>@cluster0.mongodb.net/tabletap?retryWrites=true&w=majority`
   - *(Optional)* `MONGODB_DB` = `tabletap`
4. Click **Deploy**. Vercel will host all static pages globally on the edge and route all `/api/*` requests to serverless Node functions.

### 2. MongoDB Atlas Cluster Backend
- **Multi-Device Cloud Sync**: Orders placed by customers at physical tables automatically stream into your MongoDB cluster.
- **Bi-directional Sync**: The Owner Settings page includes a **MongoDB Cluster Backend** card to test the cluster connection and perform on-demand sync between browser storage and the MongoDB Atlas cloud.
- **Offline / Standby Fallback**: If `MONGODB_URI` is not set, TableTap automatically operates in high-speed local mode without crashing.

### 3. Dynamic Real-Time Dashboard & Analytics
- **Live Calculations**: No static or mock hardcoding — all stats on the Owner Dashboard, Live Orders, Order History, and Reports pages are dynamically calculated in real time from the active restaurant database.
- **Today vs. Yesterday Comparisons**: Automated delta percentages for daily revenue and order counts.
- **Top Items Ranking & Hourly Trends**: Live distribution of sales and hourly order volumes.
- **Notification Dropdown**: Real-time bell popover with unread counter badge, pending approval alerts, waiter call resolution, and bulk approval actions.
- **CSV Data Export**: Instant, browser-agnostic CSV downloads for Live Orders, Order History, and Financial Reports.

## Run Locally

You can run TableTap locally using the included Node.js server with full API & MongoDB support:

```bash
npm install
npm start
# Server listens at http://localhost:8000
```

## Demo logins

| Role | Credentials |
|---|---|
| Owner | `owner@olivetable.demo` / `owner123` |
| Admin | `admin@tabletap.demo` / `admin123` |
| Kitchen | code `OLIVE7`, PIN `1234` |

Guest menu: `/menu/index.html?r=olive-table` (the Tables page in the owner panel gives a QR code
per table). `sitemap.html` lists every page and has a **Reset demo data** link.

## What is in here

| Path | What it is |
|---|---|
| `index.html` | Marketing site |
| `menu/` | Guest menu, cart, order status, unavailable states |
| `owner/` | Owner panel: dashboard, live orders, history, menu, tables & QR, staff, reports, settings, account |
| `kitchen/` | Kitchen pass board and completed tickets |
| `admin/` | Super admin: clients, invites, activity, plans, settings |
| `auth/` | Login, kitchen PIN login, forgot password, accept invite |
| `assets/css/` | Design system (`style.css`), self-hosted fonts (`fonts.css`) |
| `assets/js/` | `store.js` (data + money engine), `google-sync.js`, `billing.js`, `auth.js`, `realtime.js`, `helpers.js`, and one module per surface |

## Money

Taxes and charges are per restaurant: multiple taxes, percentage or fixed charges, inclusive or
exclusive pricing, and rounding. Items and categories can override the tax rate. Every placed
order stores its own breakdown, so changing rates never rewrites history.

## Docs

- `PRODUCT.md` — what the product is and who it serves
- `DESIGN.md` — the visual world, tokens and component contract
- `AGENTS.md` — the rules UI work follows in this repo
