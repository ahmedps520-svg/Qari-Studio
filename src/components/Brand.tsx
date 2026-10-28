import { useId, type SVGProps } from 'react';
import type { PresetIcon } from '../audio/presets';

/** Qari Studio mark: a mihrab arch enclosing a voice waveform. */
export function LogoMark({ size = 40, ...rest }: { size?: number } & SVGProps<SVGSVGElement>) {
  // Unique gradient ids: a gradient defined inside a hidden copy (e.g. the collapsed sidebar)
  // would otherwise make every other copy lose its colours.
  const uid = useId().replace(/:/g, '');
  const bg = `qs-bg-${uid}`;
  const gold = `qs-gold-${uid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" {...rest}>
      <defs>
        <linearGradient id={bg} x1="8" y1="2" x2="40" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#15533F" />
          <stop offset="1" stopColor="#07261C" />
        </linearGradient>
        <linearGradient id={gold} x1="24" y1="6" x2="24" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#F0D79A" />
          <stop offset="1" stopColor="#B78D3F" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="14" fill={`url(#${bg})`} />
      <rect x="1.5" y="1.5" width="45" height="45" rx="13.5" stroke="#F0D79A" strokeOpacity="0.22" />
      <path
        d="M12.5 39.5V23.2c0-6.4 4.7-10.6 11.5-15.2 6.8 4.6 11.5 8.8 11.5 15.2v16.3"
        stroke={`url(#${gold})`}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <g stroke="#F4EEDF" strokeWidth="2.4" strokeLinecap="round">
        <path d="M18 29.5v3" />
        <path d="M21 25.5v11" />
        <path d="M24 21.5v19" opacity="0.98" />
        <path d="M27 25.5v11" />
        <path d="M30 29.5v3" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="brand-name">
      Qari <em>Studio</em>
    </span>
  );
}

/** Eight-pointed star frame for surah numbers. */
export function StarFrame() {
  return (
    <svg viewBox="0 0 42 42" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" opacity="0.75">
        <rect x="8.5" y="8.5" width="25" height="25" rx="3" />
        <rect x="8.5" y="8.5" width="25" height="25" rx="3" transform="rotate(45 21 21)" />
      </g>
    </svg>
  );
}

/** Subtle geometric tessellation used behind hero areas. */
export function GeometricPattern({ id = 'qs-pattern' }: { id?: string }) {
  return (
    <svg className="geo-pattern" aria-hidden="true" width="100%" height="100%">
      <defs>
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="0.8">
            <rect x="16" y="16" width="24" height="24" />
            <rect x="16" y="16" width="24" height="24" transform="rotate(45 28 28)" />
            <circle cx="28" cy="28" r="5" />
            <path d="M0 0l16 16M56 0L40 16M0 56l16-16M56 56L40 40" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

const iconProps = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Hand-drawn glyphs for each preset's character. */
export function PresetGlyph({ icon }: { icon: PresetIcon }) {
  switch (icon) {
    case 'vanilla':
      return (
        <svg {...iconProps}>
          <path d="M4 12h3l2-4 3 8 2-4h6" />
        </svg>
      );
    case 'echo':
      return (
        <svg {...iconProps}>
          <path d="M7 8.5a5 5 0 0 1 0 7" />
          <path d="M11 6a8.5 8.5 0 0 1 0 12" opacity="0.7" />
          <path d="M15 3.8a12 12 0 0 1 0 16.4" opacity="0.4" />
          <circle cx="4" cy="12" r="1.3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'sparkle':
      return (
        <svg {...iconProps}>
          <path d="M12 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z" />
          <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
        </svg>
      );
    case 'dome':
      return (
        <svg {...iconProps}>
          <path d="M4 20h16" />
          <path d="M5.5 20v-6.5M18.5 20v-6.5" />
          <path d="M5.5 13.5c0-3.6 2.9-6.5 6.5-7.5 3.6 1 6.5 3.9 6.5 7.5z" />
          <path d="M12 6V3.5" />
          <path d="M10 20v-3.2a2 2 0 0 1 4 0V20" />
        </svg>
      );
    case 'studio':
      return (
        <svg {...iconProps}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
          <path d="M12 17.5V21M8.5 21h7" />
        </svg>
      );
    case 'warm':
      return (
        <svg {...iconProps}>
          <path d="M12 21c-3.6 0-6-2.5-6-5.6 0-3.4 2.6-5.2 3.7-8.4.3-.9 1.6-1 2-.1.6 1.5 1.3 2.3 2.3 3 .9-.9 1.3-2.1 1.4-3 2.3 1.8 2.6 5.2 2.6 8.3 0 3.3-2.4 5.8-6 5.8z" />
        </svg>
      );
    case 'feather':
      return (
        <svg {...iconProps}>
          <path d="M20 4c-6 0-12 4-13.5 11.5L5 20" />
          <path d="M20 4c0 6-3.5 11.5-11 12" />
          <path d="M9.5 12.5H15" />
        </svg>
      );
    case 'space':
      return (
        <svg {...iconProps}>
          <circle cx="12" cy="12" r="2.2" />
          <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
          <path d="M4.6 4.6a10.5 10.5 0 0 0 0 14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" opacity="0.55" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps}>
          <path d="M5 7h9M18 7h1M5 17h3M12 17h7" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
          <path d="M5 12h5M14 12h5" />
          <circle cx="12" cy="12" r="0.01" />
        </svg>
      );
  }
}
