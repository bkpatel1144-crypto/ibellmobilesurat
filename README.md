# IBELL MOBILE

Shop software for buying and selling new and used mobile phones. Built with React and Firebase; every screen updates live through Firestore `onSnapshot`.

## Features

- **Dashboard**: today's and this month's sales, net profit, stock value, money to receive and to pay, cash and bank balances, a 30-day sales chart.
- **Sales**: create a bill with one or more devices (scan or type the IMEI), optional buyer ID proof for each device, GST and discount, cash or credit, Save & Print (PDF invoice).
- **Purchases**: buy one or more devices in a single purchase, with optional seller ID proof for each device. Any device can be marked *Send to repair* while it is being added.
- **Repairs**: send stock to a repairer. When the repair is done, enter the cost; it is added to that device's cost (and to the repairer's ledger if the repairer is a party).
- **Stock**: every device with its status (in stock / in repair / sold), cost including repairs, sell or repair actions.
- **Parties**: anyone you buy from or sell to. Ledger with running balance (PDF and Excel), plus per-party analysis.
- **Analysis**: profit and loss, brand-wise, new vs used, top models, customers and suppliers, expenses, slow-moving stock.
- **Stock Audit**: start an audit, scan the barcode label of every phone on the shelf (beep + big result for each scan), see Found / Missing / Extra live, mark a phone with a damaged label by hand, then complete it to save a frozen report (PDF and Excel). Scans save as you go, so an audit survives a reload and several people can scan at once. **Audit reports are deleted automatically 15 days after they are completed** (an unfinished audit 15 days after it was started).
- **IMEI Timeline**: the full history of any IMEI: every purchase, repair and sale, with ID proofs.
- **Banks**: cash in hand plus any number of bank accounts, statements, transfers.
- **Payments**: all money received and paid, against a bill or on account.
- **Expenses**: categories, reports.
- **Settings**: logo, address, GSTIN, bill prefixes, terms, theme (white / black).

### Private cash sales

A sale paid in **Cash** is private. While the app is locked, that bill and **everything about its devices** disappear: the sale, its payment, the device from stock, its repairs, its line in the purchase, its IMEI timeline, and its share of every total, ledger and report.

- **Tap the logo 5 times** in the sidebar. The first time, you set a passkey; after that, it asks for the passkey and shows everything.
- Tap the logo 5 times again (or use the open-lock icon at the bottom of the sidebar) to lock. Reloading the page also locks.
- When unlocked, the sale form has a *Private sale* checkbox, so a cash sale can be kept visible or a non-cash sale made private.
- Private bills use their own number series (`CS-0001`…) so normal invoice numbers have no gaps.

The private view is a screen-level privacy feature for the shop counter. Anyone who signs in can still read the raw data through browser developer tools, so only give logins to people you trust.

## Setup

1. `npm install`
2. Firebase console → project **ibellmobiles-123**:
   - **Authentication → Sign-in method**: enable *Email/Password*. Under **Users**, add the shop login(s).
   - **Firestore**: the app uses the database **`mobilebillingnew`** (set in `.env`).
3. Put the login e-mail(s) in `firestore.rules`, then deploy the rules:
   ```
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore
   ```
4. `npm run dev` → open http://localhost:5173

Build for production with `npm run build`; deploy with `firebase deploy --only hosting`.

ID proofs and the logo are compressed in the browser and stored in Firestore, so the free Spark plan is enough; no Cloud Storage bucket is needed.

### Audit auto-delete (15 days)

Every audit stores an `expireAt` date. The app deletes expired audits as soon as any signed-in user opens it (and re-checks every hour), and hides them immediately.

For deletion even when nobody opens the app, also turn on Firestore's own TTL (free):
Firebase console → Firestore → database **mobilebillingnew** → **TTL** → *Create policy* → collection group `audits`, timestamp field `expireAt`.
(Firestore TTL usually removes expired documents within 24 hours of the date.)

### Team, roles & security rules

- `firestore.rules` has an **owners** list (currently `jenish@gmail.com`). Owners can always sign in and do everything.
- Staff are added in the app: **Settings → Team & Roles → Add member** (it can create their login with a password).
- **Staff permissions** (delete records, see profit & cost, reports, banks & payments, shop settings) are switched on/off there and are enforced by the rules, not only hidden in the app.
- After changing the rules file: `firebase deploy --only firestore`.

### GST

Settings → Billing → GST: turn on, choose **Bank payments only** (UPI / card / bank transfer / cheque bills get GST, cash bills don't) or **Every bill**, rate (18% for phones), price includes GST or not, HSN (8517). The shop GSTIN (Settings → General) decides CGST + SGST vs IGST. Monthly figures: **GST Report** page (PDF / Excel, HSN summary).

### Activity log

Every change is recorded with who did it (Activity Log page, owners and staff with *Reports*). Entries are kept 180 days. For server-side clean-up add a second TTL policy: collection `activity`, field `expireAt`.

## Deploy on Vercel

`vercel.json` is already set up: Vite build, `dist` output, and a rewrite so every route (`/sales/…`, `/parties/…`) loads the app on refresh.

1. Push this folder to GitHub, then on vercel.com choose **Add New → Project** and import the repo.
   (Or from this folder: `npm i -g vercel` then `vercel` and later `vercel --prod`.)
2. In **Project → Settings → Environment Variables**, add each line from your `.env` file
   (`.env` is not uploaded, so the build needs them here). Apply them to Production and Preview:
   `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
   `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`,
   `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_FIREBASE_DATABASE_ID`.
   Do **not** add `VITE_USE_EMULATOR`.
3. Deploy (or **Redeploy** if you added the variables after the first build; Vite bakes them in at build time).
4. Firebase console → **Authentication → Settings → Authorized domains** → add your Vercel domain
   (e.g. `ibell-mobile.vercel.app`). Without this, sign-in fails on the live site.

## Local testing with emulators

```
firebase emulators:start --only "auth,firestore" --project demo-ibell
# in another terminal (PowerShell):
$env:VITE_USE_EMULATOR='true'; $env:VITE_FIREBASE_PROJECT_ID='demo-ibell'; npm run dev
```
# ibellmobilesurat
