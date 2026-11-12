# Apps Script bridge

Owner setup (one time). Nothing here needs a real URL, id or token in the repo.

1. Create a **new, empty** spreadsheet in Google Sheets (this is your ledger).
2. `npm run bridge:build` produces `bridge/dist/Code.gs` (gitignored).
3. In the spreadsheet: Extensions > Apps Script. Replace the contents of the editor with the contents of `dist/Code.gs`. Save.
4. Select the function `setup` and Run it. Approve the permission prompts. It creates the sheets (Transactions, Categories, Settings, Subscriptions), the onEdit trigger and a token.
5. Open Execution log and copy the line `TOKEN (shown once...)`. It is shown only once; keep it in your password manager. To replace it later run `rotateToken` (then update the phone).
6. Deploy > New deployment > type Web app. Execute as: **Me**. Who has access: **Anyone**. Deploy and copy the Web app URL ending in `/exec`.
7. In the app, paste the setup string built from that URL and the token.

After any code change: build again, paste into the editor, then Deploy > Manage deployments > edit > Version: **New version**. The `/exec` URL only serves a saved deployment version, so skipping this keeps the old code running.

Never commit the token, the `/exec` URL, the spreadsheet id or script id.
