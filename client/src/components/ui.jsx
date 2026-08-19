import { useState } from 'react';
import Icon from './Icon.jsx';
import { mediaUrl } from '../config.js';

export function Skeleton({ w = '100%', h = 16, r = 8, style }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function Spinner({ size = 22 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

export function Cover({ src, alt, size = 48, round = false }) {
  const [err, setErr] = useState(false);
  const cls = round ? 'cover cover-round' : 'cover';
  if (!src || err) {
    return (
      <div className={cls} style={{ width: size, height: size, fontSize: size * 0.34 }}>
        <Icon name="music" size={size * 0.45} />
      </div>
    );
  }
  return (
    <img className={cls} src={mediaUrl(src)} alt={alt} style={{ width: size, height: size }} onError={() => setErr(true)} loading="lazy" />
  );
}

export function EmptyState({ icon = 'music', title, description, action, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={30} /></div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
