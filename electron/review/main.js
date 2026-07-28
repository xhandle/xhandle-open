const path = require("path");
const fs = require("fs");
const { app, BrowserWindow } = require("electron");

function loadReviewAppTitle() {
  const candidates = [
    path.join(process.resourcesPath || "", "review-package.json"),
    path.join(__dirname, "../../review-package.json"),
    path.join(__dirname, "../../build/review-package.json"),
  ];
  for (const filePath of candidates) {
    try {
      if (!filePath || !fs.existsSync(filePath)) continue;
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const title = String(parsed.appDisplayName || "").trim();
      if (title) return title;
    } catch {}
  }
  return "xHandle Code Architecture Review";
}

function createWindow() {
  const title = loadReviewAppTitle();
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    title,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, "../../build/index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
