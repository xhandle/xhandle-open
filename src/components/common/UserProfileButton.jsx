/**
 * xHandle: user profile button shared component.
 * This file defines a shared interface component used by more than one feature area inside xHandle.
 * Common components help the application feel coherent while allowing specialized engineering workflows to reuse the same interaction primitives.
 * Related files: src/App.js, src/features/settings/SettingsModal.jsx.
 */

// src/components/UserProfileButton.jsx
import { useRef, useState, useEffect } from "react";
import { LogOut, UserRound, X } from "lucide-react";

const LS_KEY = "xhandle.userProfile";

/* ---------- helpers ---------- */
function safeLoadProfile() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { name: "", title: "", company: "", avatar: "" };
    const obj = JSON.parse(raw);
    return {
      name: obj.name || "",
      title: obj.title || "",
      company: obj.company || "",
      avatar: obj.avatar || "",
    };
  } catch {
    return { name: "", title: "", company: "", avatar: "" };
  }
}

/**
 * safeSaveProfile renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param next Express next callback used to continue middleware processing.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
function safeSaveProfile(next) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return true;
  } catch {
    alert("Could not save profile (storage quota or permission issue).");
    return false;
  }
}

/**
 * fileToResizedDataURL renders a React component. It gives users access to the main engineering workspace while keeping the surrounding xHandle workspace in sync with local state and feature-specific actions.
 * @param file Input consumed by this step of the xHandle workflow.
 * @param max Input consumed by this step of the xHandle workflow.
 * @returns Rendered React UI for this part of the xHandle workspace.
 */
async function fileToResizedDataURL(file, max = 256) {
  const img = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = r.result;
    };
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const scale = Math.min(max / img.width, max / img.height, 1);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.8); // compressed jpeg
}

/* ---------- Quick Actions Modal (like Settings) ---------- */
function ProfileModal({ open, profile, onEdit, onSignOut, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed z-[70] flex justify-center w-full"
      style={{ top: "6rem", left: 0 }}
      aria-modal="true"
      role="dialog"
    >
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-base font-semibold">Account</h3>
          <button
            className="p-1 rounded hover:bg-gray-100"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 grid gap-4">
          <div className="flex items-center gap-3">
            {profile.avatar ? (
              <img
                src={profile.avatar}
                alt="User avatar"
                className="h-12 w-12 rounded-full object-cover border"
              />
            ) : (
              <div className="h-12 w-12 rounded-full bg-gray-200 border grid place-items-center text-sm font-semibold">
                {initials(profile.name)}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">
                {profile.name || "Your name"}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {profile.title || "Title"} {profile.company ? `• ${profile.company}` : ""}
              </div>
            </div>
          </div>

          <div className="grid gap-2">
            <button
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm"
              onClick={() => { onClose?.(); onEdit?.(); }}
            >
              <UserRound size={16} /> Edit profile
            </button>
            <button
              className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border hover:bg-gray-50 text-sm text-red-600"
              onClick={() => { onClose?.(); onSignOut?.(); }}
            >
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



/* ---------- main component ---------- */
export default function UserProfileButton({ onSignOut }) {
  const [profile, setProfile] = useState(() => safeLoadProfile());
  const [openModal, setOpenModal] = useState(false);
  const [editing, setEditing] = useState(false);
  const btnRef = useRef(null);

  return (
    <>
      {/* Avatar button (opens modal) */}
      <button
        ref={btnRef}
        type="button"
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full hover:bg-gray-100 transition"
        onClick={() => setOpenModal(true)}
        aria-haspopup="dialog"
        aria-expanded={openModal}
        title="Account"
      >
        {profile.avatar ? (
          <img
            src={profile.avatar}
            alt="User avatar"
            className="h-7 w-7 rounded-full object-cover border"
          />
        ) : (
          <div className="h-7 w-7 rounded-full bg-gray-200 border grid place-items-center text-xs font-semibold">
            {initials(profile.name)}
          </div>
        )}
      </button>

      {/* Quick actions modal (like Settings) */}
      <ProfileModal
        open={openModal}
        profile={profile}
        onClose={() => setOpenModal(false)}
        onEdit={() => setEditing(true)}
        onSignOut={onSignOut}
      />

      {/* Profile editor modal (unchanged) */}
      {editing && (
        <ProfileEditor
          initial={profile}
          onClose={() => setEditing(false)}
          onSave={(next) => {
            if (safeSaveProfile(next)) {
              setProfile(next);
              setEditing(false);
            }
          }}
        />
      )}
    </>
  );
}

/* ---------- utilities ---------- */
function initials(name) {
  const n = (name || "").trim();
  if (!n) return "•";
  const parts = n.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "•";
}

/* ---------- Profile Editor Modal (unchanged) ---------- */
function ProfileEditor({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial.name || "");
  const [title, setTitle] = useState(initial.title || "");
  const [company, setCompany] = useState(initial.company || "");
  const [avatar, setAvatar] = useState(initial.avatar || "");

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onPickAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await fileToResizedDataURL(file, 256);
      setAvatar(resized);
    } catch {
      alert("Could not read that image. Try another file.");
    }
  }

  return (
    <div
      className="fixed z-[80] flex justify-center w-full"
      style={{ top: "6rem", left: 0 }}
      aria-modal="true"
      role="dialog"
    >
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl border">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="text-base font-semibold">Edit profile</h3>
          <button
            className="p-1 rounded hover:bg-gray-100"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-4 grid gap-4">
          <div className="flex items-center gap-4">
            {avatar ? (
              <img
                src={avatar}
                alt="Avatar preview"
                className="h-16 w-16 rounded-full object-cover border"
              />
            ) : (
              <div className="h-16 w-16 rounded-full bg-gray-200 border" />
            )}
            <div>
              <label className="text-sm font-medium">Profile photo</label>
              <div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onPickAvatar}
                  className="mt-1 block text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  PNG/JPG, square image recommended.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Full name</label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ada Lovelace"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Title</label>
              <input
                className="mt-1 w-full rounded-md border px-3 py-2"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Founder / PM"
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Company</label>
            <input
              className="mt-1 w-full rounded-md border px-3 py-2"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Interlock Systems"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t">
          <button className="px-3 py-2 rounded-md border" onClick={onClose}>
            Cancel
          </button>
          <button
            className="px-3 py-2 rounded-md text-white"
            style={{ backgroundColor: "#7A37FF" }}
            onClick={() => onSave({ name, title, company, avatar })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
