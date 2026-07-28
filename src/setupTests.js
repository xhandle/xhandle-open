try {
  require("@testing-library/jest-dom");
} catch {
  // The app does not currently declare jest-dom; keep non-DOM tests runnable.
}
