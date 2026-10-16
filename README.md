# Checonex Retail Operations

A multi-branch point-of-sale and retail operations app built with Next.js and MySQL/MariaDB.

## Setup

1. Create a MySQL or MariaDB database, for example `checonex_retail`.
2. Copy `.env.example` to `.env.local` and configure `DATABASE_URL`, `POS_ADMIN_EMAIL`, and a strong `POS_ADMIN_PASSWORD`.
   The database account must be able to create tables and indexes in the selected database.
3. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

The app creates its tables and default branches on first database use. It seeds the sample product catalog only when the products table is empty. `POS_ADMIN_PASSWORD` creates the configured admin account if it does not exist, and resets that admin's password on startup when it does.

The UI currently uses a clean Checonex wordmark treatment for the sales preview. Replace it with Checonex's approved logo, colors, branch names, and receipt/business details before production rollout.

If your previous POS installation used `data/store.json`, set `POS_IMPORT_LEGACY_JSON=1` for one startup. The app imports legacy branches, users (not sessions), products, transactions, and transaction items once, then records the migration in the database. Remove the flag afterward. Take a backup of the JSON file and database first; the import preserves password hashes for existing users, so rotate any default or shared credentials.

## POS features

- Point of sale with inventory-aware, transactional checkout, barcode scanner input, cash tender/change calculation, cashier-attributed sales, and printable receipts.
- Shared tills with a configurable register per branch, audited shift opening/closing, cashier handover counts, and cash-variance reasons. Sales are linked to the open shift for cash reconciliation.
- Basket percentage discounts and unpaid cart-item voids require a different manager/admin to re-enter their password, plus a reason. Approval records store the cashier, approver, basket snapshot, register, shift, timestamp, and reason. Paid-sale voids/refunds are not implemented.
- Per-branch inventory with verified opening counts, receiving, signed adjustments, reorder levels, and an auditable stock-movement history. Checkout locks and decrements stock only for the selected branch.
- Inventory catalog editing for admins and managers; stock movement is branch-scoped and audited.
- Sales analytics by date range, including revenue, order count, units sold, and best sellers.
- Staff account and role administration for admins. Cashiers can sell; managers can also manage inventory and reports.
- Branch-level visibility for non-admin staff.

## Before live supermarket use

- **Checkout is intentionally disabled.** Do not change `checkoutReadiness` to enable live sales until the accountant-approved tax model is implemented and tested and fiscal receipts are integrated with the required eTIMS provider.
- POS shifts can be opened and closed while checkout is disabled to configure tills and rehearse cash counts. A shift must be open for a register before a sale can be written. At handover, the outgoing cashier closes the shift with a count; the incoming cashier signs in, selects the same till, counts the drawer, and opens the next shift. A mismatch against the previous handover count or expected cash requires a reason and is recorded in the shift audit trail. Managers/admins can add more registers per branch; the app starts with `Register 1` at each branch.
- Cashiers can request a manager-approved percentage discount or void one item from the unpaid basket. The manager must be a different user; their credentials are verified server-side and are never saved in the approval audit. Discount approvals are bound to the exact basket and become invalid if its items or quantities change. Do not treat the provisional VAT preview as an approved final amount.
- Product prices and the current 16% VAT total in the register are explicitly provisional previews, not amounts to charge customers. Configure product tax categories, exemptions, inclusive/exclusive pricing, rounding, and receipt requirements from the accountant's instructions before enabling checkout.
- Safaricom Daraja STK Push is integrated for **sandbox tests only**. Signed-in staff can start and verify their own test attempts from the POS M-Pesa sandbox tender or the M-Pesa sandbox tab; admins can also see all attempts. Attempts are user-scoped for staff, durable, accept and match callbacks, and support a Daraja status query. They do not create a sale, reserve stock, issue a receipt, or enable M-Pesa tender at checkout. Production M-Pesa, reconciliation, and payment-to-sale settlement are not implemented. Card is external/manual only.
- The posted sandbox credentials must be revoked/rotated before use. Daraja consumer keys, consumer secrets, and passkeys belong only in ignored `.env.local` for local development or the deployment secret manager; `.env.example` contains names only. Do not share replacement credentials in chat or commit them.
- Daraja sandbox configuration uses `DARAJA_ENV=sandbox`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_SHORTCODE`, `DARAJA_PASSKEY`, and a public HTTPS `DARAJA_CALLBACK_URL`. The server refuses M-Pesa initiation unless sandbox mode is explicitly selected. Do not configure production credentials in this test flow.
- For local callback testing, start Next.js with `npm run dev`, then in another terminal run `ngrok http 3000`. Copy the HTTPS forwarding address shown by ngrok and set `DARAJA_CALLBACK_URL` in ignored `.env.local` to `<ngrok-https-address>/api/payments/mpesa/callback`; restart Next.js after changing environment variables. Free ngrok URLs can change between runs, so update the URL and restart the app whenever it changes. Keep the tunnel open only while testing.
- Sign in and select **M-Pesa sandbox** in the POS tender or open the **M-Pesa sandbox** tab. Use a Daraja sandbox test number and a whole-KES test amount. Staff see only their own attempts; admins can review all attempts. The phone number is masked in the attempts list. After the sandbox callback arrives, use **Query Daraja status**; only a successful, matching callback together with a final successful provider query can mark the test attempt confirmed. An STK acceptance, a query-accepted response, or a callback alone is not proof of settlement. Do not treat a sandbox attempt as a real customer payment.
- Existing shared product quantities are deliberately **not** copied into branch stock. The database keeps those legacy values, creates branch stock rows at zero and uncounted, and blocks adding those products to a basket until an authorized manager/admin records a verified opening count with a reason for each branch.
- Barcode scanning accepts keyboard-wedge scanners that type a product barcode into the POS field and submit Enter. Register a unique barcode on each product first.

## Deployment

Configure the same database and bootstrap-admin environment variables in the deployment environment. The database host must be reachable by the Next.js server. Do not expose database credentials in client-side variables or commit `.env.local`.

