export function FociLogo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className ?? 'brand-mark'}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ width: size, height: size, flex: '0 0 auto', display: 'block', borderRadius: `${Math.round(size * 0.28)}px` }}
    >
      <rect width="64" height="64" rx="16" fill="#102a2d" stroke="rgba(113, 213, 195, 0.2)" strokeWidth="1.5" />
      <ellipse cx="32" cy="32" rx="21" ry="13" fill="none" stroke="#71d5c3" strokeWidth="3.5" />
      <circle cx="22" cy="32" r="4.5" fill="#7cc8ed" />
      <circle cx="42" cy="32" r="4.5" fill="#7cc8ed" />
    </svg>
  )
}