# Status (handoff)

## Done
- v0 app live on GitHub Pages from `main` (PR #1 merged).
- Bridge deployed in the owner's working spreadsheet; history imported (1525 rows, per-month reconcile OK, re-run adds 0 rows).
- Import rules approved by the owner.

## Open
1. iPhone: app had the wrong (non-deployment) script URL saved. Next step: put the deployment `/exec` URL into Settings > Script URL, Save, Test connection. If still "Unreachable", the Safari-reads-response-after-redirect risk (ARCHITECTURE §10 #1) is real: redesign the transport.
2. Owner to update the script to the latest `bridge/dist/Code.gs` (append fix, `EXEC_URL` property for `showSetupString`), then `rotateToken()` (the old token was shared in chat), new deployment version, new setup string on the phone only.
3. PR #2 (CLAUDE.md, Pages deploy only from main) awaits the owner's "да".
4. v1 backlog: subscriptions screen, charts, search, CSV export, iOS Shortcut.

## Notes
- Node fetch in the cloud sandbox needs `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt`.
- Bridge config for the import tool lives in gitignored `private/bridge.json`.
