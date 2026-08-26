import { useEffect } from 'react';
import Icon from './Icon.jsx';

export default function Drawer({ open, onClose, title = 'Account', children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKeyDown); document.body.style.overflow = previous; };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="drawer-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer-panel" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <div className="drawer-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close drawer"><Icon name="close" size={20} /></button></div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
