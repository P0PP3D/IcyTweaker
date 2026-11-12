// Line icons drawn for IcyCleaner (24x24, stroke = currentColor).
import type { ReactNode } from 'react';

const paths = {
  home: <path d="M3.5 11 12 4l8.5 7M5.5 9.5V20h5v-5.5h3V20h5V9.5" />,
  restore: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5v4h4" />
      <path d="M12 8v4.2l3 1.8" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  wrench: <path d="M14.5 5.2a4.2 4.2 0 0 0-5.3 5.3L3.8 16a1.6 1.6 0 0 0 0 2.2l2 2a1.6 1.6 0 0 0 2.2 0l5.5-5.4a4.2 4.2 0 0 0 5.3-5.3l-2.6 2.6-2.6-.6-.6-2.6z" />,
  layers: (
    <>
      <path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
      <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.5 11v5M13.5 11v5" />,
  network: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M11 7 6 16M13 7l5 9M7.2 18h9.6" />
    </>
  ),
  services: <path d="M4 20V13M9.3 20V8M14.7 20v-9M20 20V4M3 20.5h18" />,
  gamepad: (
    <>
      <path d="M7.5 7.5h9a4.5 4.5 0 0 1 4.4 5.4l-.8 3.8a2.3 2.3 0 0 1-4 1L14.4 15.5H9.6l-1.7 2.2a2.3 2.3 0 0 1-4-1l-.8-3.8a4.5 4.5 0 0 1 4.4-5.4z" />
      <path d="M8.5 10v3M7 11.5h3" />
      <circle cx="15.5" cy="11" r=".6" />
      <circle cx="17" cy="12.8" r=".6" />
    </>
  ),
  app: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9h17M7 6.8h.01M9.5 6.8h.01" />
    </>
  ),
  chip: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx=".8" />
      <path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21" />
    </>
  ),
  board: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="M7 7.5h4v4H7zM14 7h3M14 10h3M7 15h10M7 17.5h6" />
    </>
  ),
  pulse: <path d="M3 12h4l2-5 3.5 10 2.5-6 1.5 3H21" />,
  sparkles: (
    <>
      <path d="M11 3.5 12.6 8 17 9.5l-4.4 1.6L11 15.5l-1.6-4.4L5 9.5 9.4 8z" />
      <path d="m18 14 .8 2.2 2.2.8-2.2.8L18 20l-.8-2.2-2.2-.8 2.2-.8z" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z" />
    </>
  ),
  box: (
    <>
      <path d="m12 3.5 8 4v9l-8 4-8-4v-9z" />
      <path d="m4 7.5 8 4 8-4M12 11.5v9" />
    </>
  ),
  pie: (
    <>
      <path d="M12 3.5v8.5h8.5A8.5 8.5 0 1 1 12 3.5z" />
      <path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z" />
    </>
  ),
  drive: (
    <>
      <rect x="3.5" y="13" width="17" height="6.5" rx="2" />
      <path d="M5.5 13 8 5.5h8l2.5 7.5M16.5 16.3h.01M13.5 16.3h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  chevron: <path d="m9.5 6 6 6-6 6" />,
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  minimize: <path d="M6 12h12" />,
  maximize: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  close: <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
  undo: (
    <>
      <path d="M8.5 5 4 9.5 8.5 14" />
      <path d="M4 9.5h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  shield: (
    <>
      <path d="M12 3.5 5 6.2v5.3c0 4.3 2.9 7.6 7 9 4.1-1.4 7-4.7 7-9V6.2z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  laptop: (
    <>
      <rect x="5" y="5" width="14" height="10" rx="1.5" />
      <path d="M3 18.5h18l-1.5-3.5h-15z" />
    </>
  ),
  list: <path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />,
  sort:<path d="M7 5v14M4 16l3 3 3-3M14 7h6M14 12h4.5M14 17h3" />,
  wave: <path d="M3 15c2.5 0 2.5-6 5-6s2.5 8 5 8 2.5-11 5-11 2 4 3 4" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;

export function Icon({ name, className = 'h-[18px] w-[18px]' }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** The app mark: a snowflake on a blue tile (matches build/icon.png). */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  const arms = [0, 60, 120, 180, 240, 300];
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="logo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1d4ed8" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#logo-bg)" />
      <g stroke="#e0f2fe" strokeWidth="1.8" strokeLinecap="round">
        {arms.map((a) => (
          <g key={a} transform={`rotate(${a} 16 16)`}>
            <path d="M16 16V5.5M16 9.5l-2.6-2.4M16 9.5l2.6-2.4" />
          </g>
        ))}
      </g>
    </svg>
  );
}
