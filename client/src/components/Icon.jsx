// Inline SVG icon set — no external dependencies.
// Every glyph is drawn on a 24×24 grid and inherits `currentColor`.

const paths = {
  /* ---- navigation ---- */
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-6h6v6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  library: <><path d="M4 5v15" /><path d="M8.5 4.5v15.5" /><path d="M13 5.6l5.6 1.5a1.4 1.4 0 0 1 1 1.7L16.4 20" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" fill="currentColor" stroke="none" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
  arrowLeft: <><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></>,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronUp: <path d="m6 15 6-6 6 6" />,

  /* ---- content types ---- */
  music: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  album: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" /></>,
  disc: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3" /><path d="M12 3a9 9 0 0 1 9 9" opacity=".45" /></>,
  artist: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></>,
  users: <><circle cx="9" cy="8" r="3.6" /><path d="M2.5 21c0-3.6 3-5.5 6.5-5.5s6.5 1.9 6.5 5.5" /><path d="M16.5 4.8a3.6 3.6 0 0 1 0 6.9" /><path d="M18.5 15.9c2.1.6 3.5 2.2 3.5 5.1" /></>,
  playlist: <><path d="M4 6h16M4 12h10M4 18h7" /><path d="M15 14l5 3-5 3z" fill="currentColor" stroke="none" /></>,
  podcast: <><circle cx="12" cy="11" r="2.6" /><path d="M8.1 15.4a5.5 5.5 0 1 1 7.8 0" /><path d="M5.3 18.6a9.5 9.5 0 1 1 13.4 0" /></>,
  mic: <><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0" /><path d="M12 17.5V21" /></>,
  headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="2.6" y="13.4" width="4.6" height="7" rx="2.2" /><rect x="16.8" y="13.4" width="4.6" height="7" rx="2.2" /></>,
  wave: <><path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-2" /></>,
  equalizer: <><path d="M6 20V10M12 20V4M18 20v-7" /><circle cx="6" cy="7" r="1.8" /><circle cx="12" cy="17" r="1.8" fill="currentColor" stroke="none" /><circle cx="18" cy="10" r="1.8" /></>,

  /* ---- transport ---- */
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: <><rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /><rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" /></>,
  playCircle: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l6-3.5z" fill="currentColor" stroke="none" /></>,
  next: <><path d="M6 5v14l9-7z" fill="currentColor" stroke="none" /><path d="M18 5v14" /></>,
  prev: <><path d="M18 5v14l-9-7z" fill="currentColor" stroke="none" /><path d="M6 5v14" /></>,
  shuffle: <><path d="M16 3.5 20.5 8 16 12.5" /><path d="M16 11.5 20.5 16 16 20.5" /><path d="M3.5 8h3.2c1.6 0 2.6 1 3.6 2.4" /><path d="M3.5 16h3.2c2.6 0 3.5-2.6 5.4-5.2 1.1-1.5 2.2-2.8 4-2.8h4.4" /><path d="M14.7 16H20" /></>,
  repeat: <><path d="M17 2.5 21 6l-4 3.5" /><path d="M3 11.5V10a4 4 0 0 1 4-4h14" /><path d="M7 21.5 3 18l4-3.5" /><path d="M21 12.5V14a4 4 0 0 1-4 4H3" /></>,
  repeatOne: <><path d="M17 2.5 21 6l-4 3.5" /><path d="M3 11.5V10a4 4 0 0 1 4-4h14" /><path d="M7 21.5 3 18l4-3.5" /><path d="M21 12.5V14a4 4 0 0 1-4 4H3" /><text x="12" y="15" fontSize="8" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700" fontFamily="system-ui, sans-serif">1</text></>,
  skipBack10: <><path d="M3.5 13a8.5 8.5 0 1 1 2.2 5.5" /><path d="M3.5 8.5v4.5H8" /><text x="12" y="15" fontSize="6.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700" fontFamily="system-ui, sans-serif">10</text></>,
  skipForward10: <><path d="M20.5 13a8.5 8.5 0 1 0-2.2 5.5" /><path d="M20.5 8.5v4.5H16" /><text x="12" y="15" fontSize="6.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700" fontFamily="system-ui, sans-serif">10</text></>,
  skipBack15: <><path d="M3.5 13a8.5 8.5 0 1 1 2.2 5.5" /><path d="M3.5 8.5v4.5H8" /><text x="12" y="15" fontSize="6.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700" fontFamily="system-ui, sans-serif">15</text></>,
  skipForward30: <><path d="M20.5 13a8.5 8.5 0 1 0-2.2 5.5" /><path d="M20.5 8.5v4.5H16" /><text x="12" y="15" fontSize="6.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700" fontFamily="system-ui, sans-serif">30</text></>,
  volume: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a9 9 0 0 1 0 12" /></>,
  volumeLow: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 9.5a4 4 0 0 1 0 5" /></>,
  volumeMute: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="m16 9.5 5 5M21 9.5l-5 5" /></>,
  queue: <><path d="M3 6h12M3 11h12M3 16h7" /><path d="M17 12.5v7" /><circle cx="19.2" cy="19.4" r="2.1" fill="currentColor" stroke="none" /><path d="M17 12.5c1.6-.4 3.4-.6 4.6-.2" /></>,
  cast: <><path d="M3 18.5a2.5 2.5 0 0 1 2.5 2.5" /><path d="M3 14.5a6.5 6.5 0 0 1 6.5 6.5" /><path d="M3 10.5A10.5 10.5 0 0 1 13.5 21" /><path d="M20.5 21V6.5a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v1" /><path d="M16.5 21h4" /></>,
  pip: <><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><rect x="12.5" y="11" width="7" height="6.5" rx="1.4" fill="currentColor" stroke="none" /></>,
  expand: <><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /></>,
  collapse: <><path d="M4 9h3a2 2 0 0 0 2-2V4" /><path d="M20 9h-3a2 2 0 0 1-2-2V4" /><path d="M15 20v-3a2 2 0 0 1 2-2h3" /><path d="M9 20v-3a2 2 0 0 0-2-2H4" /></>,

  /* ---- actions ---- */
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
  check: <path d="M20 6 9 17l-5-5" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.6-4.9" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></>,
  more: <><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" /></>,
  moreH: <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  share: <><circle cx="18" cy="5" r="2.6" /><circle cx="6" cy="12" r="2.6" /><circle cx="18" cy="19" r="2.6" /><path d="M8.3 10.7 15.7 6.4M8.3 13.3l7.4 4.3" /></>,
  heart: <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4.5 6 4.5c2.2 0 3.7 1.2 4.5 2.4.8-1.2 2.3-2.4 4.5-2.4 3.7 0 5.6 3.9 4 7.2C16.5 16.4 12 21 12 21z" />,
  heartFill: <path d="M12 21s-7.5-4.6-10-9.3C.4 8.4 2.3 4.5 6 4.5c2.2 0 3.7 1.2 4.5 2.4.8-1.2 2.3-2.4 4.5-2.4 3.7 0 5.6 3.9 4 7.2C16.5 16.4 12 21 12 21z" fill="currentColor" stroke="none" />,
  upload: <><path d="M12 16V4" /><path d="m7 8 5-5 5 5" /><path d="M4 20h16" /></>,
  download: <><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M4 20h16" /></>,
  downloadCircle: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v7" /><path d="m9 11.5 3 3 3-3" /></>,
  cloud: <><path d="M6.8 18.5A4.3 4.3 0 0 1 7 10a5.6 5.6 0 0 1 10.7 1.4 3.8 3.8 0 0 1-.7 7.1z" /></>,
  cloudSync: <><path d="M6.8 17.5A4.3 4.3 0 0 1 7 9a5.6 5.6 0 0 1 10.7 1.4 3.8 3.8 0 0 1 .1 7.1" /><path d="M9.5 20.5 12 18l2.5 2.5" /><path d="M12 18v4.5" opacity=".6" /></>,
  sync: <><path d="M20.5 11.5A8.5 8.5 0 0 0 6 6.2L3.5 8.5" /><path d="M3.5 12.5A8.5 8.5 0 0 0 18 17.8l2.5-2.3" /><path d="M3.5 4v4.5H8" /><path d="M20.5 20v-4.5H16" /></>,
  folder: <><path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  folderPlus: <><path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 11.5v6M9 14.5h6" /></>,
  folderImage: <><path d="M3 7.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="9.5" cy="12.5" r="1.3" fill="currentColor" stroke="none" /><path d="m5.5 18.5 4-4 3 3 2.5-2 3.5 3.5" /></>,
  pin: <><path d="M9 3.5h6l-.8 5.2 3.3 3.3H6.5l3.3-3.3z" /><path d="M12 12v8.5" /></>,
  sort: <><path d="M4 6.5h14M4 12h9M4 17.5h5" /><path d="M18 12.5V20" /><path d="m15.5 17.5 2.5 2.5 2.5-2.5" /></>,
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  list: <><path d="M8.5 6h12M8.5 12h12M8.5 18h12" /><circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none" /><circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none" /></>,
  filter: <><path d="M3 5.5h18l-7 8v6l-4 2v-8z" /></>,
  refresh: <><path d="M20.5 11.5A8.5 8.5 0 0 0 6 6.2L3.5 8.5" /><path d="M3.5 12.5A8.5 8.5 0 0 0 18 17.8l2.5-2.3" /><path d="M3.5 4v4.5H8" /><path d="M20.5 20v-4.5H16" /></>,

  /* ---- system ---- */
  bell: <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9" /><path d="M13.7 19.5a2 2 0 0 1-3.4 0" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5" /><path d="M21 12H9" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2.5" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" fill="currentColor" stroke="none" />,
  trending: <><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></>,
  crown: <><path d="m3 7.5 4 3.5 5-6.5 5 6.5 4-3.5-1.8 11H4.8z" /><path d="M4.8 18.5h14.4" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></>,
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  storage: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  lock: <><rect x="4" y="10.5" width="16" height="10.5" rx="2.4" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  mail: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="m3 7 9 6 9-6" /></>,
  eye: <><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M9.9 5.7A9.8 9.8 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.4 4.1" /><path d="M6.3 7.8A16.7 16.7 0 0 0 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.3-1" /><path d="M3 3l18 18" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" /></>,
  star: <path d="m12 3.5 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.8l6-.8z" />,
  lossless: <><circle cx="12" cy="12" r="9" /><path d="M7.5 14V9.5M7.5 14h3" /><path d="M13.5 14V9.5l3 4.5V9.5" /></>,
  broadcast: <><circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" /><path d="M8.6 15.4a4.8 4.8 0 0 1 0-6.8" /><path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8" /><path d="M5.8 18.2a8.8 8.8 0 0 1 0-12.4" /><path d="M18.2 5.8a8.8 8.8 0 0 1 0 12.4" /></>
};

export default function Icon({ name, size = 20, className = '', strokeWidth = 1.7, title }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {paths[name] || paths.music}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(paths);
