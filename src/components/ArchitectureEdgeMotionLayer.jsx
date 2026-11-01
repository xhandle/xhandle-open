import { useEffect } from 'react';
import { useStoreApi } from 'reactflow';
import { createArchitectureEdgeMotionCache } from './architectureEdgeMotionCache';
import { createArchitecturePinchZoom } from './architecturePinchZoom';

export default function ArchitectureEdgeMotionLayer({ hostRef, enabled, scope }) {
  const store = useStoreApi();
  useEffect(() => {
    if (enabled && hostRef.current) {
      const releaseCache = createArchitectureEdgeMotionCache(hostRef.current, store);
      const releasePinch = createArchitecturePinchZoom(hostRef.current, store);
      return () => { releasePinch(); releaseCache(); };
    }
    return undefined;
  }, [hostRef, enabled, scope, store]);
  return null;
}
