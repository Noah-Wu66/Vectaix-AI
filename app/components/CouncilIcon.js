const COUNCIL_ICON_SRC = "/icons/claudecode-color.svg";

function CouncilImage({ size, className = "", rounded = "0px", padding = 0 }) {
  return (
    <span
      className={`inline-flex items-center justify-center overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        padding,
      }}
      aria-hidden="true"
    >
      <img
        src={COUNCIL_ICON_SRC}
        alt=""
        width={size}
        height={size}
        className="block h-full w-full object-contain"
        loading="eager"
        decoding="async"
      />
    </span>
  );
}

export function CouncilIcon({ size = 16, className = "" }) {
  return <CouncilImage size={size} className={className} />;
}

export function CouncilAvatar({ size = 24 }) {
  return (
    <span
      className="inline-flex items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: "8px",
        background: "#F4E3DB",
      }}
    >
      <CouncilImage size={size} padding={2} />
    </span>
  );
}
