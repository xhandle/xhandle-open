# Desktop integration

`xhandle-open` owns the React application, shared workflows, data formats, and API server. A separate private `xhandle-desktop` repository owns the Electron main/preload processes, native integrations, installers, and release automation. Do not copy application source into the desktop shell or add Electron dependencies here.

The desktop repository references this repository as `upstream/xhandle-open`, a Git submodule pinned to a full commit SHA. Shared fixes belong here first. Desktop updates move the submodule pointer in a reviewed PR and run build and smoke checks before release. Each desktop build records both repository commits and an upstream source URL. Packaged releases must use a clean, published upstream commit.

The API entrypoint exports its Express app when required and starts listening only when run directly. This lets external hosts manage its bind address, lifecycle, and writable working directory without changing shared API logic. The regular `npm run dev` workflow remains supported.

Native review packaging is an optional external tool. Set `XHANDLE_REVIEW_PACKAGER_DIR` to its checkout. It must expose `npm run package:review` and accept `REVIEW_PACKAGE_PATH`, `REVIEW_APP_TARGET`, and `REVIEW_OUTPUT_DIR`. The desktop packager builds its pinned shared source. JSON review export does not require native tooling.

Browser localStorage and IndexedDB belong to the browser origin/profile. A desktop profile is separate. Use the existing workspace backup/export and restore/import tools to move data; do not copy live browser database files. Preserve the desktop application ID, custom protocol origin, and user-data path across updates.
