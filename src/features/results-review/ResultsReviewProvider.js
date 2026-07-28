import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import ResultsReviewDrawer from "./ResultsReviewDrawer";
import { loadReviewItems, saveReviewItems } from "./reviewStore";
import { REVIEW_STATUSES } from "./reviewTypes";
import { createHistoryEntry, filterReviewItems, normalizeReviewItem } from "./reviewUtils";

const ResultsReviewContext = createContext(null);

const dispatchReviewEvent = (type, detail) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
};

function reviewItemBelongsToProject(item = {}, projectId) {
  if (!projectId) return false;
  if (item.projectId === projectId) return true;

  const artifactId = String(item.artifactId || "");
  const artifactParts = artifactId.split(":");
  if (["hazard-summary", "functional-decomposition", "code-architecture-hazard-summary", "code-architecture-functional-decomposition"].includes(artifactParts[0]) && artifactParts[1] === projectId) {
    return true;
  }

  return [
    item.id,
    item.sourceRunId,
    item.artifactId,
  ].filter(Boolean).some((value) => String(value).includes(projectId));
}

export function ResultsReviewProvider({ children, readOnly = false, initialReviewItems = null }) {
  const [reviewItems, setReviewItems] = useState([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [drawerOptions, setDrawerOptions] = useState({});

  useEffect(() => {
    let cancelled = false;
    const loader = Array.isArray(initialReviewItems)
      ? Promise.resolve(initialReviewItems)
      : loadReviewItems();
    loader
      .then((items) => {
        if (!cancelled) setReviewItems(Array.isArray(items) ? items : []);
      })
      .catch((error) => {
        console.warn("[results-review] failed to initialize", error);
        if (!cancelled) setReviewItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialReviewItems]);

  const persist = useCallback((updater) => {
    if (readOnly) {
      const nextItems = typeof updater === "function" ? updater(reviewItems) : updater;
      return Array.isArray(nextItems) ? nextItems : [];
    }
    let nextItems = [];
    setReviewItems((prev) => {
      nextItems = typeof updater === "function" ? updater(prev) : updater;
      nextItems = Array.isArray(nextItems) ? nextItems : [];
      saveReviewItems(nextItems);
      return nextItems;
    });
    return nextItems;
  }, [readOnly, reviewItems]);

  const getReviewItems = useCallback((filters = {}) => filterReviewItems(reviewItems, filters), [reviewItems]);
  const getReviewItemById = useCallback((id) => reviewItems.find((item) => item.id === id) || null, [reviewItems]);

  const openResultsReviewDrawer = useCallback((options = {}) => {
    setDrawerOptions(options || {});
    setDrawerOpen(true);
  }, []);

  const closeResultsReviewDrawer = useCallback(() => setDrawerOpen(false), []);
  const toggleResultsReviewDrawerExpanded = useCallback(() => {
    setDrawerExpanded((expanded) => !expanded);
  }, []);

  const toggleResultsReviewDrawer = useCallback((options = {}) => {
    setDrawerOptions(options || {});
    setDrawerOpen((open) => !open);
  }, []);

  const createReviewItems = useCallback(async (items = []) => {
    if (readOnly) return [];
    const normalized = (Array.isArray(items) ? items : []).map(normalizeReviewItem);
    persist((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      normalized.forEach((item) => {
        const existing = byId.get(item.id);
        byId.set(item.id, existing ? { ...existing, ...item, originalContent: existing.originalContent } : item);
      });
      return Array.from(byId.values());
    });
    return normalized;
  }, [persist, readOnly]);

  const updateReviewItem = useCallback(async (id, updates = {}) => {
    if (readOnly) return getReviewItemById(id);
    let updated = null;
    persist((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        updated = {
          ...item,
          ...updates,
          id: item.id,
          originalContent: item.originalContent,
          updatedAt: new Date().toISOString(),
        };
        return updated;
      })
    );
    if (updated) dispatchReviewEvent("xhandle:results-review:item-updated", { reviewItem: updated });
    return updated;
  }, [persist, readOnly, getReviewItemById]);

  const deleteReviewItemsForProject = useCallback(async (projectId) => {
    if (readOnly) return [];
    if (!projectId) return [];
    let removed = [];
    persist((prev) => {
      removed = prev.filter((item) => reviewItemBelongsToProject(item, projectId));
      return prev.filter((item) => !reviewItemBelongsToProject(item, projectId));
    });
    if (removed.length) {
      dispatchReviewEvent("xhandle:results-review:items-deleted", { projectId, reviewItems: removed });
    }
    setDrawerOpen(false);
    return removed;
  }, [persist, readOnly]);

  const applyAction = useCallback(async (id, action, updates = {}) => {
    if (readOnly) return getReviewItemById(id);
    let updated = null;
    persist((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        updated = {
          ...item,
          ...updates,
          originalContent: item.originalContent,
          reviewerFeedback: updates.reviewerFeedback ?? item.reviewerFeedback,
          reviewedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: (Number(item.version) || 1) + 1,
          history: [...(item.history || []), createHistoryEntry(action, { status: updates.status, feedback: updates.reviewerFeedback })],
        };
        return updated;
      })
    );
    if (updated) dispatchReviewEvent("xhandle:results-review:item-updated", { reviewItem: updated, action });
    return updated;
  }, [persist, readOnly, getReviewItemById]);

  const approveAsIs = useCallback((id) =>
    applyAction(id, "approve_as_is", { status: REVIEW_STATUSES.APPROVED_AS_IS }), [applyAction]);

  const approveWithModifications = useCallback((id, updatedContent, feedback = "") =>
    applyAction(id, "approve_with_modifications", {
      status: REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS,
      currentContent: updatedContent,
      reviewerFeedback: feedback,
    }), [applyAction]);

  const rejectReviewItem = useCallback((id, feedback = "") =>
    applyAction(id, "reject", { status: REVIEW_STATUSES.REJECTED, reviewerFeedback: feedback }), [applyAction]);

  const markNeedsRegeneration = useCallback((id, feedback = "") =>
    applyAction(id, "needs_regeneration", { status: REVIEW_STATUSES.NEEDS_REGENERATION, reviewerFeedback: feedback }), [applyAction]);

  const requestReviewItemRegeneration = useCallback(async (id) => {
    const updated = await applyAction(id, "regenerate_requested", { status: REVIEW_STATUSES.NEEDS_REGENERATION });
    if (updated) {
      dispatchReviewEvent("xhandle:results-review:regenerate-requested", { reviewItem: updated });
    }
    return updated;
  }, [applyAction]);

  const markNeedsMoreContext = useCallback((id, feedback = "") =>
    applyAction(id, "needs_more_context", { status: REVIEW_STATUSES.NEEDS_MORE_CONTEXT, reviewerFeedback: feedback }), [applyAction]);

  const supersedeReviewItem = useCallback((id, replacementItemId) =>
    applyAction(id, "supersede", { status: REVIEW_STATUSES.SUPERSEDED, replacementItemId }), [applyAction]);

  const value = useMemo(() => ({
    reviewItems,
    openResultsReviewDrawer,
    closeResultsReviewDrawer,
    toggleResultsReviewDrawer,
    getReviewItems,
    getReviewItemById,
    createReviewItems,
    updateReviewItem,
    deleteReviewItemsForProject,
    approveAsIs,
    approveWithModifications,
    rejectReviewItem,
    markNeedsRegeneration,
    requestReviewItemRegeneration,
    markNeedsMoreContext,
    supersedeReviewItem,
  }), [
    reviewItems,
    openResultsReviewDrawer,
    closeResultsReviewDrawer,
    toggleResultsReviewDrawer,
    getReviewItems,
    getReviewItemById,
    createReviewItems,
    updateReviewItem,
    deleteReviewItemsForProject,
    approveAsIs,
    approveWithModifications,
    rejectReviewItem,
    markNeedsRegeneration,
    requestReviewItemRegeneration,
    markNeedsMoreContext,
    supersedeReviewItem,
  ]);

  return (
    <ResultsReviewContext.Provider value={value}>
      <div className={`results-review-app-frame ${drawerOpen ? "results-review-app-frame--drawer-open" : ""} ${drawerOpen && drawerExpanded ? "results-review-app-frame--drawer-expanded" : ""}`}>
        {children}
      </div>
      <ResultsReviewDrawer
        isOpen={drawerOpen}
        isExpanded={drawerExpanded}
        options={drawerOptions}
        items={reviewItems}
        onClose={closeResultsReviewDrawer}
        onToggleExpanded={toggleResultsReviewDrawerExpanded}
        onApproveAsIs={readOnly ? undefined : approveAsIs}
        onApproveWithModifications={readOnly ? undefined : approveWithModifications}
        onReject={readOnly ? undefined : rejectReviewItem}
        onNeedsRegeneration={readOnly ? undefined : markNeedsRegeneration}
        onRequestRegeneration={readOnly ? undefined : requestReviewItemRegeneration}
        onNeedsMoreContext={readOnly ? undefined : markNeedsMoreContext}
        readOnly={readOnly}
      />
    </ResultsReviewContext.Provider>
  );
}

export function useResultsReview() {
  const context = useContext(ResultsReviewContext);
  if (!context) {
    return {
      reviewItems: [],
      openResultsReviewDrawer: () => {},
      closeResultsReviewDrawer: () => {},
      toggleResultsReviewDrawer: () => {},
      getReviewItems: () => [],
      getReviewItemById: () => null,
      createReviewItems: async () => [],
      updateReviewItem: async () => null,
      deleteReviewItemsForProject: async () => [],
      approveAsIs: async () => null,
      approveWithModifications: async () => null,
      rejectReviewItem: async () => null,
      markNeedsRegeneration: async () => null,
      requestReviewItemRegeneration: async () => null,
      markNeedsMoreContext: async () => null,
      supersedeReviewItem: async () => null,
    };
  }
  return context;
}
