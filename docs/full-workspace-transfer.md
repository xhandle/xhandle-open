# Move a full workspace between installations

Both installations must run a build containing **Full workspace export and import**, including its local API endpoints. Older desktop releases need an update before they can import these files.

1. In the source installation, save your work, finish or cancel analyses, and close other xHandle tabs. Keep the local API server running.
2. Open **Settings → Backup**. Under **Full workspace export and import**, acknowledge the quiet-workspace checklist and click **Export Full Workspace**.
3. Saved API keys and integration tokens are excluded by default. Select their checkbox only if you want them in the file. The file is unencrypted, including any selected credentials; store it privately.
4. In the destination installation, export its current workspace first if you want a permanent copy. Then open **Settings → Backup → Choose Full Workspace File**.
5. Review the validated project, database, record, settings, and baseline counts. A file containing credentials has a separate option to restore them; otherwise destination credentials are preserved.
6. Acknowledge the checklist and select **Import and Replace Workspace**. Confirm replacement, wait for completion, and click **Reload xHandle**.
7. Reconnect external source folders and backup folders as needed.

Import replaces the destination workspace; it does not merge projects. Existing folder backups and their legacy import controls remain available separately.

The transfer includes app IndexedDB records and binary attachments, browser preferences and session drafts, and the local server's baseline catalog and current-account integration settings. Structured values such as dates, maps, sets, and typed arrays retain their types. The server's baseline catalog is installation-wide; saved integration credentials are account-scoped.

Browser and OS folder permissions, external files never saved in xHandle, cookies, environment variables, and running jobs cannot be moved by this file. Source indexes and snapshots already saved in xHandle are included. This format is JSON with encoded binary content and is processed in memory, so large workspaces require sufficient memory and destination disk space.

The importer validates the format, checksum, database compatibility, and backend payload before replacement. It saves a local recovery checkpoint and pauses automatic backups while applying changes. If import fails, it attempts rollback. If recovery cannot finish, keep the installation's local storage intact, restore API availability, and select **Recover Previous Workspace**. On startup, an interrupted import blocks normal workspace loading until recovery succeeds. Reload after import or recovery so open views read the restored data.
