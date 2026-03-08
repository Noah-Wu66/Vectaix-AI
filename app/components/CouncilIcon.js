export function CouncilIconSprite() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="absolute h-0 w-0 overflow-hidden"
    >
      <symbol id="pplx-icon-gavel" viewBox="0 0 24 24">
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="m14 13l-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381M16 16l6-6m-.5.5l-8-8M8 8l6-6M8.5 7.5l8 8"
        />
      </symbol>
    </svg>
  );
}

export function CouncilIcon({ size = 16, className = "" }) {
  const classes = ["inline-flex fill-current shrink-0", className].filter(Boolean).join(" ");

  return (
    <svg
      role="img"
      aria-hidden="true"
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 24 24"
    >
      <use xlinkHref="#pplx-icon-gavel" href="#pplx-icon-gavel" />
    </svg>
  );
}

export function CouncilAvatar({ size = 24 }) {
  return (
    <div
      className="flex items-center justify-center rounded-md bg-amber-100 text-amber-600"
      style={{ width: size, height: size }}
    >
      <CouncilIcon size={Math.max(14, Math.round(size * 0.65))} />
    </div>
  );
}
