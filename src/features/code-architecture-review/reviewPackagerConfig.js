function trimTrailingSlashes(value) {
  return String(value || "").trim().replace(/\/+$/g, "");
}

export function configuredReviewPackagerUrl() {
  return "";
}

export function configuredReviewPackagerAuthToken() {
  return "";
}

export function reviewPackagerRequestHeaders() {
  const token = configuredReviewPackagerAuthToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export function codeArchitectureReviewPackagingTarget(backendUrl) {
  const value = trimTrailingSlashes(backendUrl);
  if (!value) {
    return { mode: "local", url: "http://localhost:5001" };
  }
  return { mode: "local", url: value };
}

export function isHostedCodeArchitectureReviewPackagerConfigured() {
  return codeArchitectureReviewPackagingTarget().mode === "hosted";
}

export function codeArchitectureReviewPackageStartBody({
  reviewPackage,
  reviewAppTarget = "mac",
  destinationDirectory = "",
  packagingMode = "local",
} = {}) {
  return {
    reviewPackage,
    reviewAppTarget,
    ...(packagingMode === "local" ? { destinationDirectory } : {}),
  };
}
