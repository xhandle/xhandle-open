import React from 'react';
import './designDialog.css';

// Keep controls in the same form while only its content can scroll.
export default function DesignDialogForm({ as: Element = 'form', className = 'artifact-form', children, footer, ...props }) {
  return <Element {...props} className={`${className} design-dialog-panel`}>
    <div className="design-dialog-body design-dialog-form-body">{children}</div>
    {footer && <div className="design-dialog-footer design-dialog-form-footer">{footer}</div>}
  </Element>;
}
