const ATTACHMENT_DB_NAME = "SafetyCaseEvidenceDB";
const ATTACHMENT_DB_VERSION = 1;
const ATTACHMENT_STORE = "Attachments";

function uuid(prefix = "attachment") {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function openAttachmentDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }

    const request = indexedDB.open(ATTACHMENT_DB_NAME, ATTACHMENT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        const store = db.createObjectStore(ATTACHMENT_STORE, { keyPath: "id" });
        store.createIndex("by_project", "projectId", { unique: false });
        store.createIndex("by_safety_case", "safetyCaseId", { unique: false });
        store.createIndex("by_node", "nodeId", { unique: false });
        store.createIndex("by_created", "createdAt", { unique: false });
      }
    };
    request.onerror = () => reject(request.error || new Error("Unable to open attachment database."));
    request.onsuccess = () => resolve(request.result);
  });
}

function putAttachment(db, attachment) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, "readwrite");
    const request = tx.objectStore(ATTACHMENT_STORE).put(attachment);
    request.onerror = () => reject(request.error || new Error("Unable to save attachment."));
    request.onsuccess = () => resolve(attachment);
  });
}

export async function saveSafetyCaseEvidenceAttachments(files, { projectId = null, safetyCaseId = null, nodeId = null } = {}) {
  const list = Array.from(files || []);
  if (!list.length) return [];

  const db = await openAttachmentDB();
  try {
    const saved = [];
    for (const file of list) {
      const dataUrl = await readFileAsDataUrl(file);
      const createdAt = new Date().toISOString();
      const attachment = {
        id: uuid("file"),
        title: file.name,
        name: file.name,
        type: "file-attachment",
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        projectId,
        safetyCaseId,
        nodeId,
        source: "uploaded-file",
        description: `Uploaded file: ${file.name}`,
        createdAt,
        updatedAt: createdAt,
        dataUrl,
      };
      saved.push(await putAttachment(db, attachment));
    }
    return saved;
  } finally {
    db.close?.();
  }
}

