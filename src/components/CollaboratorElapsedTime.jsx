import React, { useEffect, useState } from 'react';

// Keep the clock local to this small component, not the conversation or workspace.
export default function CollaboratorElapsedTime({ startedAt }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span aria-live="off" className="text-xs font-normal text-neutral-500">
    {seconds < 60 ? `${seconds}s elapsed` : `${Math.floor(seconds / 60)}m ${seconds % 60}s elapsed`}
  </span>;
}
