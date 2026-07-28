import React from "react";
import { importSysMLV2TextSubset, serializeSysMLV2Text } from "./sysmlV2Serializer";

export default function SysMLV2TextualView({ model, onImported }) {
  const text = React.useMemo(() => serializeSysMLV2Text(model), [model]);
  const [draft, setDraft] = React.useState(text);
  const [message, setMessage] = React.useState("");
  React.useEffect(() => setDraft(text), [text]);

  return (
    <div className="bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-sm font-semibold">SysML v2-style textual export subset</div>
          <div className="text-xs text-gray-500">Readable supported subset, not a complete OMG SysML v2 grammar implementation.</div>
        </div>
        <div className="flex gap-2">
          <button className="rounded border px-2 py-1 text-xs" onClick={() => navigator.clipboard?.writeText(draft)}>Copy</button>
          <button
            className="rounded bg-indigo-600 px-2 py-1 text-xs text-white"
            onClick={() => {
              const result = importSysMLV2TextSubset(draft);
              if (result.status === "success") {
                setMessage(result.warnings?.length ? result.warnings.join(" ") : "Imported textual subset.");
                onImported?.(result.model);
              } else {
                setMessage(result.errors?.join(" ") || "Import failed.");
              }
            }}
          >
            Import subset
          </button>
        </div>
      </div>
      <textarea className="h-32 w-full rounded border bg-slate-950 p-3 font-mono text-xs text-slate-100" value={draft} onChange={(e) => setDraft(e.target.value)} />
      {message ? <div className="mt-2 rounded border bg-amber-50 px-3 py-2 text-xs text-amber-800">{message}</div> : null}
    </div>
  );
}
