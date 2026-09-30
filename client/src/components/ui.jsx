import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { mediaUrl } from '../config.js';
import { cachedCoverBlobUrl } from '../offline.js';

/* ------------------------------------------------------------------ atoms */

export function Skeleton({ w = '100%', h = 16, r = 10, style }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export function Spinner({ size = 20 }) {
  return <span className="spinner" style={{ width: size, height: size }} />;
}

/** Artwork with an offline-cache fallback and a graceful placeholder. */
export function Cover({ src, alt, size = 48, round = false, className = '' }) {
  const [err, setErr] = useState(false);
  const [localUrl, setLocalUrl] = useState(null);

  useEffect(() => { setErr(false); setLocalUrl(null); }, [src]);

  const cls = `cover ${round ? 'cover-round' : ''} ${className}`.trim();
  const dim = size === '100%' ? { width: '100%', height: '100%' } : { width: size, height: size };

  const onErr = async () => {
    if (localUrl) { setErr(true); return; }
    const u = await cachedCoverBlobUrl(src);
    if (u) setLocalUrl(u); else setErr(true);
  };

  if (!src || err) {
    return (
      <div className={cls} style={dim}>
        <Icon name="music" size={typeof size === 'number' ? Math.max(14, size * 0.42) : 26} />
      </div>
    );
  }

  return (
    <img
      className={cls}
      src={localUrl || mediaUrl(src)}
      alt={alt || ''}
      style={dim}
      onError={onErr}
      loading="lazy"
    />
  );
}

/* --------------------------------------------------------------- page hero */

/**
 * The page header used across the whole app: gradient icon tile, big title
 * with an optional status chip, a subtitle, and right-aligned actions.
 */
export function PageHero({ icon, iconVariant = '', title, chip, chipTone = '', subtitle, actions, children }) {
  return (
    <div className="page-hero">
      {icon && (
        <div className={`hero-icon ${iconVariant}`}>
          {typeof icon === 'string' ? <Icon name={icon} size={26} /> : icon}
        </div>
      )}
      <div className="hero-text">
        <div className="hero-title-row">
          <h1>{title}</h1>
          {chip && <span className={`hero-chip ${chipTone}`}>{chip}</span>}
        </div>
        {subtitle && <p className="hero-sub">{subtitle}</p>}
        {children}
      </div>
      {actions && <div className="hero-actions">{actions}</div>}
    </div>
  );
}

/** Backwards-compatible alias so older call sites keep working. */
export function PageHeader({ title, subtitle, actions, icon = 'music' }) {
  return <PageHero icon={icon} title={title} subtitle={subtitle} actions={actions} />;
}

export function SectionHead({ icon, title, note, action }) {
  return (
    <div className="section-head">
      <h2>
        {icon && <Icon name={icon} size={17} />}
        {title}
      </h2>
      {action || (note && <span className="section-note">{note}</span>)}
    </div>
  );
}

/* ----------------------------------------------------------------- filters */

/** Horizontal pill filter bar. `options` = [{ id, label, icon, iconGreen }]. */
export function FilterChips({ options, value, onChange, ariaLabel = 'Filter' }) {
  return (
    <div className="chip-row chip-row--scroll" role="tablist" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            role="tab"
            aria-selected={active}
            className={`chip ${active ? 'active' : ''}`}
            onClick={() => onChange(opt.id)}
          >
            {opt.icon && <Icon name={opt.icon} size={14} className={opt.iconGreen ? 'chip-icon-green' : ''} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Dropdown sort control. `options` = [{ id, label }]. */
export function SortMenu({ options, value, onChange, label = 'Sort' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const active = options.find((o) => o.id === value) || options[0];

  return (
    <div className="sort-wrap" ref={ref}>
      <button className="sort-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Icon name="sort" size={15} />
        {label}: {active?.label}
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="sort-menu" role="menu">
          {options.map((opt) => (
            <button
              key={opt.id}
              role="menuitemradio"
              aria-checked={opt.id === value}
              className={`sort-menu-item ${opt.id === value ? 'active' : ''}`}
              onClick={() => { onChange(opt.id); setOpen(false); }}
            >
              {opt.label}
              {opt.id === value && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Grid / list layout switch. */
export function ViewToggle({ value, onChange }) {
  return (
    <div className="view-toggle" role="group" aria-label="Layout">
      <button
        className={`view-btn ${value === 'grid' ? 'active' : ''}`}
        onClick={() => onChange('grid')}
        aria-label="Grid view"
        aria-pressed={value === 'grid'}
      >
        <Icon name="grid" size={16} />
      </button>
      <button
        className={`view-btn ${value === 'list' ? 'active' : ''}`}
        onClick={() => onChange('list')}
        aria-label="List view"
        aria-pressed={value === 'list'}
      >
        <Icon name="list" size={16} />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ states */

export function EmptyState({ icon = 'music', title, description, action, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon"><Icon name={icon} size={28} /></div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
      {children}
    </div>
  );
}

export function GridSkeleton({ count = 6, height = 230 }) {
  return (
    <div className="collection-grid">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} h={height} r={14} />)}
    </div>
  );
}

export function RowSkeleton({ count = 6, height = 62 }) {
  return (
    <div className="stack">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} h={height} r={12} />)}
    </div>
  );
}

/* ------------------------------------------------------------------- stats */

export function StatTile({ icon, value, label, tone = '' }) {
  return (
    <div className="stat-tile">
      <span className={`stat-tile-icon ${tone}`}><Icon name={icon} size={19} /></span>
      <span className="stat-tile-meta">
        <strong>{value}</strong>
        <small>{label}</small>
      </span>
    </div>
  );
}

/**
 * The summary strip from the design: progress ring, headline numbers and
 * two actions. Every number is passed in from live data.
 */
export function SummaryPanel({ percent = 0, title, subtitle, stats = [], actions }) {
  return (
    <div className="storage-panel">
      <div className="storage-ring" style={{ '--pct': Math.max(0, Math.min(100, percent)) }}>
        <span>{Math.round(percent)}%</span>
      </div>
      <div className="storage-info">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      <div className="storage-divider" />
      <div className="storage-stats">
        {stats.map((s) => (
          <div className="storage-stat" key={s.label}>
            <strong>{s.value}</strong>
            <small>{s.label}</small>
          </div>
        ))}
      </div>
      {actions && <div className="storage-actions">{actions}</div>}
    </div>
  );
}
