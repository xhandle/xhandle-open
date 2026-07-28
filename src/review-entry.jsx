import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ActivityProvider } from "./components/activity/ActivityCenter";
import ReviewPackageApp from "./features/code-architecture-review/ReviewPackageApp";

async function loadReviewPackage() {
  if (typeof window !== "undefined" && window.xHandleReviewPackage?.load) {
    const loaded = await window.xHandleReviewPackage.load();
    if (loaded) return loaded;
  }
  const response = await fetch("./review-package.json");
  if (!response.ok) throw new Error(`Unable to load review-package.json (${response.status})`);
  return response.json();
}

function ReviewRoot() {
  const [reviewPackage, setReviewPackage] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadReviewPackage()
      .then((loaded) => {
        if (!cancelled) setReviewPackage(loaded);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError?.message || "Unable to load review package.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="grid h-screen place-items-center bg-white p-6 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!reviewPackage) {
    return (
      <div className="grid h-screen place-items-center bg-white p-6 text-sm text-slate-600">
        Loading xHandle review package...
      </div>
    );
  }

  return <ReviewPackageApp reviewPackage={reviewPackage} />;
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ActivityProvider>
      <ReviewRoot />
    </ActivityProvider>
  </React.StrictMode>
);
