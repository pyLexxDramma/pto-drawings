type PtoLogoProps = {
  className?: string;
  title?: string;
};

/** Марка PTO: слева сетка чертежа, справа строки текста, литера «П». */
export function PtoLogo({ className = "h-8 w-8", title = "PTO" }: PtoLogoProps) {
  const gradId = "ptoLogoGrad";
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={gradId} x1="10" y1="2" x2="54" y2="62">
          <stop stopColor="#2b6bed" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${gradId})`} />

      <rect
        x="10"
        y="14"
        width="20"
        height="36"
        rx="3"
        fill="#eff6ff"
        fillOpacity="0.14"
        stroke="#93c5fd"
        strokeWidth="1.2"
      />
      <g stroke="#bfdbfe" strokeWidth="1.15" strokeLinecap="square" opacity="0.9">
        <path d="M14 20h12M14 25h8M14 30h11M14 35h7" />
        <path d="M14 40h12v5H14z" fill="none" />
      </g>

      <g stroke="#e2e8f0" strokeWidth="1.4" strokeLinecap="round" opacity="0.92">
        <path d="M37 21h16M37 27h13M37 33h16M37 39h11M37 45h7" />
      </g>

      <path d="M32 13v38" stroke="#93c5fd" strokeWidth="1.25" opacity="0.7" />

      <path
        fill="#fff"
        d="M21 49V19h12c5.4 0 8.8 3 8.8 7.6 0 4.7-3.4 7.7-8.8 7.7H27.5V49H21zm6.5-17.5v5.6h4.8c2.5 0 4-1.3 4-3.3s-1.5-3.3-4-3.3h-4.8z"
      />
    </svg>
  );
}
