import fs from "fs";
import path from "path";

function sourceFilesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesIn(entryPath);
    if (!/\.(?:js|jsx)$/.test(entry.name) || /\.test\.(?:js|jsx)$/.test(entry.name)) return [];
    return [entryPath];
  });
}

describe("button-triggered AI workflows", () => {
  it("routes every chat request through the selected-provider auth helper", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const chatRequestFiles = sourceFilesIn(sourceRoot).filter((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return /fetch\([^)]*(?:\/api\/chat|\/chat)/s.test(source);
    });
    const bypasses = chatRequestFiles
      .filter((filePath) => !fs.readFileSync(filePath, "utf8").includes("buildAIAuthOpts"))
      .map((filePath) => path.relative(sourceRoot, filePath));

    expect(chatRequestFiles.length).toBeGreaterThan(0);
    expect(bypasses).toEqual([]);
  });
});
