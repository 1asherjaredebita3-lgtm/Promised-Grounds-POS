# Promised Grounds — Café POS

An iPad-friendly counter for your church youth café. Prices are examples: edit them before service.

## Customer Live Orders

A customer board is included at `live/`. Follow `LIVE-SETUP.md` to connect the free Supabase backend and create your staff login. It uses ten-second updates, protects writes with staff authentication, and publishes only customer-safe fields. It is not live across devices until configured.

## Files you can edit
- `index.html`: labels, page sections, and form fields.
- `styles.css`: all styling. The brand palette is at the top in `:root`.
- `app.js`: sample menu, checkout, timers, saved orders, and Sheets synchronization. Prices in DEFAULT_MENU are in centavos (10000 = PHP 100).
- `google-sheets.gs`: the Google Sheets receiver.
- `config.js`: public Supabase connection settings.
- `cloud.js`: staff authentication and database requests.
- `live/index.html`, `live.css`, `live.js`: the customer board.
- `supabase-setup.sql`: database tables, permissions, and publishing function.

The requested Montserrat font uses locally installed Montserrat when available, with Avenir/system fallbacks. No external font or library is required.

## During service
1. Tap menu items. Adjust quantities using + / −.
2. Enter the customer name and any notes.
3. Choose Cash, GCash, or Unpaid. Cash requires an amount received at least equal to the total.
4. Place the order. It is saved on this browser before the cart clears.
5. The live order queue stays at the bottom of the ordering screen. Timers appear immediately when you place an order. Use Ready / Collected there, or View full queue for all preparation controls.
6. The timer runs from placement until ready. Ready and completed orders retain the measured preparation time. Orange/red indicates a wait over the threshold.
7. History includes cancellations and lets you download a CSV backup.

GCash is a payment record, not a GCash payment processor. Verify payment separately. Unpaid orders have no settle-payment action in this version; use that mode only when you want to record them as unpaid.

## Google Sheets connection
1. Create or choose your reporting spreadsheet. Its ID is between `/d/` and `/edit` in the URL.
2. Open Extensions → Apps Script. Paste `google-sheets.gs`.
3. Replace SPREADSHEET_ID and SYNC_KEY. Use a long random key, not your Google password. Keep the key private.
4. Deploy → New deployment → Web app. Execute as Me; access Anyone. Authorize Google when prompted. If your Workspace forbids this access mode, your administrator must enable an appropriate deployment or you must use a different authorized backend.
5. Copy the URL ending in `/exec`.
6. In POS Settings, paste that URL and the same key, then Save connection.
7. Place a small test order and confirm its row appears in the Orders tab. Change its status and confirm the same row updates. A successful acknowledgement changes the POS label to Synced.
8. Cancel your test order to exclude it from paid sales.

Script edits require updating the deployment to a new version. Use the deployment URL, not an Apps Script editor URL. Google Apps Script quotas and account permissions apply.

## What gets logged
Order UUID and number, time, customer, type/table, item names/quantities/unit prices, total, payment method, cash and change, status, ready/collected/cancelled timestamps, preparation seconds, notes, and revision. There is one row per order; later statuses update that row. This is not a chronological audit of every button press.

Unconfirmed writes remain pending. The app retries every 30 seconds while open and when connectivity returns. A full snapshot plus UUID/revision prevents duplicate rows and older retries overwriting new statuses. Google Sheets logging has not been live-tested until you configure the receiver and verify a row. Browser network restrictions can cause an unconfirmed response; keep the pending record and verify your sheet before troubleshooting.

## Data and device limits
Orders and menu are saved in localStorage on this device. Sheets is a reporting destination, not a queue backend; a second cashier iPad has its own queue. Once configured, Supabase publishes customer statuses across phones; it does not merge multiple cashier histories. Keep one active counter tab per device to avoid simultaneous localStorage writes. Avoid private browsing, clearing site data, or changing browsers during service. Export backups daily. Quota/storage errors prevent checkout from claiming an order was saved.

A refresh preserves saved orders and their timers. An unplaced cart is not saved. The site itself needs to load online; offline order storage works only while the already loaded page stays open. There is no installed offline service worker.

The sync key is stored in this browser. Use trusted staff devices and keep the website private. This starter has no cashier roles, printer integration, inventory tracking, refunds, VAT calculations, or official receipt generation.

## Code proofing checklist
- Replace example products and prices.
- Check the brand palette and all customer-facing labels.
- Try Cash, GCash, and Unpaid checkout.
- Confirm cash change calculation and quantity changes.
- Place an order, refresh, and check that its waiting timer continues.
- Mark ready and verify the timer stops.
- Confirm a Sheets row appears and changes status without duplicating.
- Export a backup and inspect the CSV.
