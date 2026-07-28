const fs = require("fs");
const path = require("path");
const { contextBridge } = require("electron");

function candidatePackagePaths() {
  return [
    path.join(process.resourcesPath || "", "review-package.json"),
    path.join(__dirname, "review-package.json"),
    path.join(__dirname, "../../build/review-package.json"),
    path.join(process.cwd(), "review-package.json"),
  ];
}

contextBridge.exposeInMainWorld("xHandleReviewPackage", {
  async load() {
    for (const filePath of candidatePackagePaths()) {
      try {
        if (!filePath || !fs.existsSync(filePath)) continue;
        return JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch {
        return null;
      }
    }
    return null;
  },
});
