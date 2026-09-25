import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import ResultsReviewDrawer from "./ResultsReviewDrawer";
import { loadReviewItems, saveReviewItems } from "./reviewStore";
import {
  REVIEW_LIFECYCLE_STATES,
  REVIEW_STATUSES,
  reviewLifecycleStateForItem,
} from "./reviewTypes";
import { createHistoryEntry, filterReviewItems, mergeVibeReviewEvidenceItems, normalizeReviewItem } from "./reviewUtils";

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
  const reviewItemsRef = useRef([]);
  const persistenceQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    const loader = Array.isArray(initialReviewItems)
      ? Promise.resolve(initialReviewItems)
      : loadReviewItems();
    loader
      .then((items) => {
        if (!cancelled) {
          const nextItems = Array.isArray(items) ? items : [];
          reviewItemsRef.current = nextItems;
          setReviewItems(nextItems);
        }
      })
      .catch((error) => {
        console.warn("[results-review] failed to initialize", error);
        if (!cancelled) setReviewItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [initialReviewItems]);

  const [persistenceFailure, setPersistenceFailure] = useState(null);

  const persist = useCallback(async (updater) => {
    const previousItems = reviewItemsRef.current;
    if (readOnly) {
      const nextItems = typeof updater === "function" ? updater(previousItems) : updater;
      return Array.isArray(nextItems) ? nextItems : [];
    }
    let nextItems = typeof updater === "function" ? updater(previousItems) : updater;
    nextItems = Array.isArray(nextItems) ? nextItems : [];
    reviewItemsRef.current = nextItems;
    setReviewItems(nextItems);
    persistenceQueueRef.current = persistenceQueueRef.current
      .catch(() => {})
      .then(() => saveReviewItems(nextItems));
    const saved = await persistenceQueueRef.current;
    // Optimistic in-memory state is kept so the reviewer does not lose their
    // work mid-session, but the failure is announced rather than swallowed:
    // this evidence will not survive a reload.
    if (saved && saved.ok === false) {
      setPersistenceFailure({ at: new Date().toISOString(), failure: saved.failure, message: saved.message });
      try {
        window.dispatchEvent(new CustomEvent("xhandle:results-review:persistence-failed", {
          detail: { itemCount: nextItems.length, failure: saved.failure, message: saved.message },
        }));
      } catch {}
    } else if (saved && saved.ok) {
      setPersistenceFailure(null);
    }
    return nextItems;
  }, [readOnly]);

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
    await persist((prev) => {
      const byId = new Map(prev.map((item) => [item.id, item]));
      normalized.forEach((item) => {
        const existing = byId.get(item.id);
        byId.set(item.id, existing ? { ...existing, ...item, originalContent: existing.originalContent } : item);
      });
      return Array.from(byId.values());
    });
    return normalized;
  }, [persist, readOnly]);

  const recordVibeReviewEvidence = useCallback(async (incomingItem) => {
    if (readOnly || !incomingItem?.id) return null;
    let recorded = null;
    await persist((prev) => {
      const merged = mergeVibeReviewEvidenceItems(prev, incomingItem);
      recorded = merged.recorded;
      return merged.items;
    });
    if (recorded) dispatchReviewEvent("xhandle:results-review:item-updated", { reviewItem: recorded, action: "collaborator_vibe_review" });
    return recorded;
  }, [persist, readOnly]);

  const updateReviewItem = useCallback(async (id, updates = {}) => {
    if (readOnly) return getReviewItemById(id);
    let updated = null;
    await persist((prev) =>
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
    await persist((prev) => {
      removed = prev.filter((item) => reviewItemBelongsToProject(item, projectId));
      return prev.filter((item) => !reviewItemBelongsToProject(item, projectId));
    });
    if (removed.length) {
      dispatchReviewEvent("xhandle:results-review:items-deleted", { projectId, reviewItems: removed });
    }
    setDrawerOpen(false);
    return removed;
  }, [persist, readOnly]);

  const deleteReviewItemsByIds = useCallback(async (ids = []) => {
    if (readOnly) return [];
    const idSet = new Set((Array.isArray(ids) ? ids : []).filter(Boolean));
    if (!idSet.size) return [];
    let removed = [];
    await persist((prev) => {
      removed = prev.filter((item) => idSet.has(item.id));
      return prev.filter((item) => !idSet.has(item.id));
    });
    if (removed.length) dispatchReviewEvent("xhandle:results-review:items-deleted", { reviewItems: removed });
    setDrawerOpen(false);
    return removed;
  }, [persist, readOnly]);

  const applyAction = useCallback(async (id, action, updates = {}) => {
    if (readOnly) return getReviewItemById(id);
    let updated = null;
    await persist((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const { historyDetails = {}, ...itemUpdates } = updates;
        updated = {
          ...item,
          ...itemUpdates,
          originalContent: item.originalContent,
          reviewerFeedback: itemUpdates.reviewerFeedback ?? item.reviewerFeedback,
          reviewedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: (Number(item.version) || 1) + 1,
          history: [...(item.history || []), createHistoryEntry(action, {
            status: itemUpdates.status,
            reviewState: itemUpdates.reviewState,
            feedback: itemUpdates.reviewerFeedback,
            ...historyDetails,
          })],
        };
        return updated;
      })
    );
    if (updated) dispatchReviewEvent("xhandle:results-review:item-updated", { reviewItem: updated, action });
    return updated;
  }, [persist, readOnly, getReviewItemById]);

  const setReviewItemsState = useCallback(async (ids = [], reviewState) => {
    if (readOnly) return [];
    if (!Object.values(REVIEW_LIFECYCLE_STATES).includes(reviewState)) return [];
    const idSet = new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean));
    if (!idSet.size) return [];
    const changed = [];
    const changedAt = new Date().toISOString();
    await persist((prev) => prev.map((item) => {
      if (!idSet.has(item.id)) return item;
      const previousReviewState = reviewLifecycleStateForItem(item);
      if (previousReviewState === reviewState) return item;
      const updated = {
        ...item,
        reviewState,
        reviewedAt: changedAt,
        updatedAt: changedAt,
        version: (Number(item.version) || 1) + 1,
        history: [...(item.history || []), createHistoryEntry("review_state_changed", {
          previousReviewState,
          reviewState,
          source: "Review Center",
        })],
      };
      changed.push(updated);
      return updated;
    }));
    changed.forEach((reviewItem) => {
      dispatchReviewEvent("xhandle:results-review:item-updated", { reviewItem, action: "review_state_changed" });
    });
    return changed;
  }, [persist, readOnly]);

  const approveAsIs = useCallback((id) =>
    applyAction(id, "approve_as_is", { status: REVIEW_STATUSES.APPROVED_AS_IS, reviewState: REVIEW_LIFECYCLE_STATES.CLOSED }), [applyAction]);

  const approveWithModifications = useCallback((id, updatedContent, feedback = "") =>
    applyAction(id, "approve_with_modifications", {
      status: REVIEW_STATUSES.APPROVED_WITH_MODIFICATIONS,
      reviewState: REVIEW_LIFECYCLE_STATES.CLOSED,
      currentContent: updatedContent,
      reviewerFeedback: feedback,
    }), [applyAction]);

  const rejectReviewItem = useCallback((id, feedback = "") =>
    applyAction(id, "reject", { status: REVIEW_STATUSES.REJECTED, reviewState: REVIEW_LIFECYCLE_STATES.CLOSED, reviewerFeedback: feedback }), [applyAction]);

  const markNeedsRegeneration = useCallback((id, feedback = "") =>
    applyAction(id, "needs_regeneration", { status: REVIEW_STATUSES.NEEDS_REGENERATION, reviewState: REVIEW_LIFECYCLE_STATES.IN_PROGRESS, reviewerFeedback: feedback }), [applyAction]);

  const requestReviewItemRegeneration = useCallback(async (id) => {
    const updated = await applyAction(id, "regenerate_requested", { status: REVIEW_STATUSES.NEEDS_REGENERATION, reviewState: REVIEW_LIFECYCLE_STATES.IN_PROGRESS });
    if (updated) {
      dispatchReviewEvent("xhandle:results-review:regenerate-requested", { reviewItem: updated });
    }
    return updated;
  }, [applyAction]);

  const markNeedsMoreContext = useCallback((id, feedback = "") =>
    applyAction(id, "needs_more_context", { status: REVIEW_STATUSES.NEEDS_MORE_CONTEXT, reviewState: REVIEW_LIFECYCLE_STATES.IN_PROGRESS, reviewerFeedback: feedback }), [applyAction]);

  const supersedeReviewItem = useCallback((id, replacementItemId) =>
    applyAction(id, "supersede", { status: REVIEW_STATUSES.SUPERSEDED, reviewState: REVIEW_LIFECYCLE_STATES.CLOSED, replacementItemId }), [applyAction]);

  const value = useMemo(() => ({
    reviewItems,
    /** Non-null when review evidence is in memory only and will not survive a reload. */
    persistenceFailure,
    openResultsReviewDrawer,
    closeResultsReviewDrawer,
    toggleResultsReviewDrawer,
    getReviewItems,
    getReviewItemById,
    createReviewItems,
    recordVibeReviewEvidence,
    updateReviewItem,
    deleteReviewItemsForProject,
    deleteReviewItemsByIds,
    setReviewItemsState,
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
    recordVibeReviewEvidence,
    updateReviewItem,
    deleteReviewItemsForProject,
    deleteReviewItemsByIds,
    setReviewItemsState,
    approveAsIs,
    approveWithModifications,
    rejectReviewItem,
    markNeedsRegeneration,
    requestReviewItemRegeneration,
    markNeedsMoreContext,
    supersedeReviewItem,
  , persistenceFailure]);

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
        onUpdateCurrentContent={readOnly ? undefined : async (id, updatedContent, feedback = "") => {
          const updated = await updateReviewItem(id, {
            currentContent: updatedContent,
            reviewerFeedback: feedback,
          });
          if (updated) {
            window.dispatchEvent(new CustomEvent("xhandle:results-review:item-updated", {
              detail: { reviewItem: updated, action: "update_current_content" },
            }));
          }
          return updated;
        }}
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
      recordVibeReviewEvidence: async () => null,
      updateReviewItem: async () => null,
      deleteReviewItemsForProject: async () => [],
      deleteReviewItemsByIds: async () => [],
      setReviewItemsState: async () => [],
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
