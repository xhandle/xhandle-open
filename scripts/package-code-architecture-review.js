const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Arch, Platform, build } = require("electron-builder");

const rootDir = path.resolve(__dirname, "..");
const workDir = process.env.REVIEW_WORK_DIR
  ? path.resolve(process.env.REVIEW_WORK_DIR)
  : path.join(rootDir, ".review-package-work");
const appDir = path.join(workDir, "app");
const outputDir = process.env.REVIEW_OUTPUT_DIR
  ? path.resolve(process.env.REVIEW_OUTPUT_DIR)
  : path.join(rootDir, "dist-review");
const reviewPackagePath = process.env.REVIEW_PACKAGE_PATH
  ? path.resolve(process.env.REVIEW_PACKAGE_PATH)
  : path.join(rootDir, "review-package.json");
const electronVersion = require("electron/package.json").version;
const DEFAULT_MAC_APP_ID = "com.xhandle.code-architecture-review";
const REVIEW_APP_VERSION = "0.1.0";

function safePackageName(value, fallback = "xHandle Code Architecture Review") {
  return String(value || fallback)
    .replace(/[/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || fallback;
}

function packageSlug(value, fallback = "xhandle-code-architecture-review") {
  return String(value || fallback)
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || fallback;
}

function normalizeReviewAppTarget(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (["mac", "macos", "darwin"].includes(raw)) return "mac";
  if (["win", "windows", "win32"].includes(raw)) return "win";
  if (["linux"].includes(raw)) return "linux";
  if (process.platform === "win32") return "win";
  if (process.platform === "linux") return "linux";
  return "mac";
}

function electronBuilderTarget(target) {
  if (target === "win") return Platform.WINDOWS.createTarget(["zip"], Arch.x64);
  if (target === "linux") return Platform.LINUX.createTarget(["zip"], Arch.x64);
  return Platform.MAC.createTarget(["zip"], Arch.x64);
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || rootDir,
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${options.label || command} failed with exit code ${result.status}.${output ? `\n${output}` : ""}`);
  }
  return result;
}

function stripMacExtendedAttributes(targetPath) {
  if (process.platform !== "darwin" || !targetPath || !fs.existsSync(targetPath)) return;
  runChecked("xattr", ["-cr", targetPath], {
    label: `Clearing macOS extended attributes from ${path.relative(rootDir, targetPath) || targetPath}`,
  });
}

function findBuiltMacApp(appDisplayName) {
  const macDir = path.join(outputDir, "mac");
  const expected = path.join(macDir, `${appDisplayName}.app`);
  if (fs.existsSync(expected)) return expected;
  if (!fs.existsSync(macDir)) return null;
  const appName = fs.readdirSync(macDir).find((name) => name.endsWith(".app"));
  return appName ? path.join(macDir, appName) : null;
}

function copyRequiredPath(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`Required review app input is missing: ${path.relative(rootDir, from)}`);
  }
  fs.cpSync(from, to, { recursive: true });
}

async function main() {
  if (!fs.existsSync(reviewPackagePath)) {
    throw new Error("review-package.json is required before packaging the review app.");
  }
  const reviewPackage = JSON.parse(fs.readFileSync(reviewPackagePath, "utf8"));
  const appDisplayName = safePackageName(reviewPackage.appDisplayName);
  const reviewTarget = normalizeReviewAppTarget(process.env.REVIEW_APP_TARGET || reviewPackage.reviewAppTarget);

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(appDir, { recursive: true });

  copyRequiredPath(path.join(rootDir, "build"), path.join(appDir, "build"));
  copyRequiredPath(path.join(rootDir, "electron", "review"), path.join(appDir, "electron", "review"));
  copyRequiredPath(reviewPackagePath, path.join(appDir, "review-package.json"));
  copyRequiredPath(path.join(rootDir, "public", "x_Logo.PNG"), path.join(appDir, "build", "icon.png"));

  fs.writeFileSync(
    path.join(appDir, "package.json"),
	    JSON.stringify({
	      name: packageSlug(appDisplayName),
	      version: REVIEW_APP_VERSION,
	      private: true,
	      description: `Read-only ${appDisplayName} package`,
	      author: "xHandle",
	      main: "electron/review/main.js",
    }, null, 2)
  );

  stripMacExtendedAttributes(appDir);

  await build({
    projectDir: appDir,
    publish: "never",
    targets: electronBuilderTarget(reviewTarget),
    config: {
	      appId: process.env.REVIEW_APP_BUNDLE_ID || DEFAULT_MAC_APP_ID,
	      productName: appDisplayName,
      electronVersion,
      asar: true,
      npmRebuild: false,
      nodeGypRebuild: false,
      publish: null,
      generateUpdatesFilesForAllChannels: false,
      directories: {
        output: outputDir,
      },
      afterPack: async (context) => {
        stripMacExtendedAttributes(context.appOutDir);
      },
      files: [
        "build/**/*",
        "electron/review/**/*",
        "package.json",
      ],
      extraResources: [
        {
          from: path.join(appDir, "review-package.json"),
          to: "review-package.json",
        },
      ],
      mac: {
        target: ["zip"],
        artifactName: "${productName}-${version}-mac.${ext}",
        icon: path.join(appDir, "build", "icon.png"),
        category: "public.app-category.developer-tools",
        identity: null,
        hardenedRuntime: true,
        gatekeeperAssess: false,
        entitlements: path.join(appDir, "electron", "review", "entitlements.mac.plist"),
        entitlementsInherit: path.join(appDir, "electron", "review", "entitlements.mac.plist"),
        notarize: false,
      },
      win: {
        target: ["zip"],
        artifactName: "${productName}-${version}-win.${ext}",
        icon: path.join(appDir, "build", "icon.png"),
      },
      linux: {
        target: ["zip"],
        artifactName: "${productName}-${version}-linux.${ext}",
        icon: path.join(appDir, "build", "icon.png"),
      },
    },
  });

  if (reviewTarget === "mac" && process.platform === "darwin") {
    const appPath = findBuiltMacApp(appDisplayName);
    if (!appPath) throw new Error("Electron Builder completed, but no macOS app bundle was found.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
