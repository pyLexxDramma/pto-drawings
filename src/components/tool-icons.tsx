type IconProps = { className?: string };

export function IconBack({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M10 3 5 8l5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconDownload({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2.5v8M8 10.5 5.5 8M8 10.5 10.5 8M3 13h10"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconMark({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4 12.5 11.2 5.3a1.2 1.2 0 0 0-1.7-1.7L2.3 10.8 2 14l3.2-.3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconCheck({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5 6.5 11.5 12.5 4.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconExpand({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSplit({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="3" width="4.5" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="3" width="4.5" height="10" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function IconGrid({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="2.5" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="9.5" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9.5" y="9.5" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function IconSync({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 8a5 5 0 0 1 8.5-3.5M13 5V3h-2M13 8a5 5 0 0 1-8.5 3.5M3 11v2h2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSearch({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.2 10.2 13.5 13.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function IconMic({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="5.5" y="2" width="5" height="8" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconThumbs({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2.5" y="2.5" width="4" height="4.5" rx="0.75" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2.5" y="9" width="4" height="4.5" rx="0.75" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 4.5h4.5M9 7h4.5M9 10h4.5M9 12.5h4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconPencil({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3 10.6 10.4 3.2a1.7 1.7 0 0 1 2.4 2.4L5.4 13 2.5 13.5 3 10.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9.3 4.3l2.4 2.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconDoc({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M4.5 2.5h5l3 3V13.5h-8v-11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9.5 2.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
