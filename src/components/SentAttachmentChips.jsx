import React, { memo, useEffect, useRef, useState } from 'react';
import AttachmentPreview from './AttachmentPreview';
import CollaboratorAttachmentCard from './CollaboratorAttachmentCard';
import { loadAttachmentPreview } from '../lib/collaboratorAttachmentPreviews';

function SentAttachmentCard({ attachment, onOpen }) {
  const cardRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const { previewId, kind } = attachment;

  useEffect(() => {
    if (kind !== 'image') return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px' });
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    setImageDataUrl('');
    if (visible && kind === 'image' && previewId) {
      loadAttachmentPreview({ previewId }).then(preview => {
        if (!cancelled) setImageDataUrl(preview?.imageDataUrl || '');
      }, () => {});
    }
    return () => { cancelled = true; };
  }, [visible, kind, previewId]);

  return (
    <div ref={cardRef} className="max-w-full">
      <CollaboratorAttachmentCard name={attachment.name} kind={kind} imageDataUrl={imageDataUrl}
        onOpen={() => onOpen(attachment)} />
    </div>
  );
}

function SentAttachmentChips({ attachments = [] }) {
  const [selected, setSelected] = useState(null);
  if (!attachments.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2 pr-12" aria-label="Sent attachments">
      {attachments.map((attachment, index) => (
        <SentAttachmentCard key={attachment.previewId || attachment.id || index} attachment={attachment} onOpen={setSelected} />
      ))}
      {selected && <AttachmentPreview key={selected.previewId || selected.id} attachment={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

export default memo(SentAttachmentChips);
