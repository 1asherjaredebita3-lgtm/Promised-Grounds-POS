# Free Live Orders setup — Promised Grounds

The code is ready. A shared Supabase project must be connected before customers can see orders across devices. This setup uses your own free accounts; it does not create paid resources.

## 1. Create the free database
1. Open https://supabase.com and create an account/project on the **Free** plan. Choose a region near the Philippines. Store your database password privately; it is not used in website code.
2. Open SQL Editor and run the complete `supabase-setup.sql` file.
3. Open Authentication → Users and add a staff user with an email and password. Confirm that user when adding it. This is the cashier login, separate from your Supabase dashboard login.
4. Copy the user's UUID. In SQL Editor, run:

```sql
insert into public.staff_users(user_id) values ('PASTE_STAFF_USER_UUID');
```

5. Keep public signups disabled in your Authentication settings if they are not needed. Only allowlisted staff can write orders, even if another account exists.

## 2. Connect the website
1. Find your project's URL and **publishable key** (or legacy anon/public key) in the project API settings.
2. Open `config.js` and fill in `url` and `publishableKey`.
3. Leave `refreshSeconds: 10` for ten-second customer updates. Requests pause while the customer page is hidden.
4. Never put a service_role key, secret key, database password, or staff password in code or GitHub. The public key is safe because the SQL grants and RLS policies restrict access.

## 3. Upload to GitHub and deploy on Netlify
Upload all extracted files, including the `live` folder. Keep `index.html` at the repository root.

- Build command: leave empty.
- Publish directory: `.`
- Keep your Netlify and Supabase plans on Free.
- Use the included netlify.toml; no Functions or build tools are required.

Your staff POS is at `https://YOUR-SITE.netlify.app/`.
Your customer board is at `https://YOUR-SITE.netlify.app/live/`.
Share ONLY the customer board link or make a QR code for that URL.

## 4. Sign in and verify
1. Open POS → Settings → Customer Live Orders. Sign in with the allowlisted staff email and password. Pending saved orders publish after sign-in.
2. Place a test order. It appears on your iPad immediately and on a different phone's `/live/` page within roughly ten seconds after publication.
3. A published label confirms the database acknowledged the current revision. Pending means customers may not see the newest status yet.
4. Mark it Ready. Check that the customer board shows Ready for pickup and stops the preparation timer.
5. Mark Collected. It disappears from the customer board on the next refresh.
6. Cancel the test order if appropriate before using real sales reporting.
7. Configure Google Sheets separately using the existing receiver. Cloud queue and Sheets each have their own acknowledgement and retry status.

## Free plan limits checked October 12, 2026
- Supabase Free: 500 MB database, 5 GB egress, and unlimited API requests; free projects pause after one week of inactivity. Resume a paused project in the dashboard and test it before café service.
- Netlify Free: 300 credits per month on current credit-based plans. It has hard monthly limits and pauses when limits are reached; the Free plan does not incur overage costs. Older accounts may have legacy plans.
- Free plans are limited services, not a promise of uninterrupted hosting. Keep daily CSV backups and check account usage.

Sources: https://supabase.com/pricing and https://www.netlify.com/pricing/

## Privacy and permissions
Customers can read only recent active order numbers, first names, status, and timestamps. The customer-safe queue contains no full customer names, payment amounts, or notes. Anonymous writes are denied. Order history payloads have no public table access; approved staff save them through a checked database function. Collected/cancelled orders are removed from the public queue; the read policy hides entries older than 18 hours.

The POS UI is publicly accessible on Netlify, but customer-board writes require an allowlisted staff login. Public visitors can create only browser-local orders until authorized. Staff sessions stay in the current tab's sessionStorage and expire/refresh through Supabase. Signing out stops publication from that tab; it does not erase existing queued orders.

## Operational limits
- Use one cashier iPad and one active POS tab in this version. Other staff devices do not pull a shared cashier history or menu; Supabase shares the customer board only. Keep using the original cashier device for status changes.
- The bottom timer begins when Place order saves the order. The customer board can show it only after a successful database write and refresh.
- Internet failures preserve local orders and leave publication pending. The open POS retries every ten seconds while staff is signed in.
- The board clearly warns when updates fail and retains the last received statuses rather than claiming they are current.
- Local timers depend on device clocks. Enable automatic date/time on devices.
- Old local pending orders are synced after sign-in; entries older than 18 hours are hidden from customers.
- Google Sheets logging still requires its one-time Apps Script setup. It does not depend on the customer board and is not the live queue backend.

## Verification status
Code syntax and simulated checkout/synchronization checks were run. Real Supabase SQL execution, authentication, cross-device writes, Netlify hosting, Google Sheets writes, and iPad layout must be verified once your account configuration is added. No database credentials or paid resources were provisioned for you.
