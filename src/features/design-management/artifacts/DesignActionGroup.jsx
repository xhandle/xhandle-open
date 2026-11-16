import React from 'react';

// Native disclosures preserve keyboard access and keep secondary commands out
// of the initial list. The shared name allows only one category open at a time.
export default function DesignActionGroup({ label, children }) {
  return <details className="design-action-group" name="design-action-category">
    <summary>{label}</summary><div className="design-actions-list">{children}</div>
  </details>;
}
