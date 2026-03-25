function CouncilSvg({ size, animate = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible" }}
    >
      {animate && (
        <style>{`
          @keyframes vexBounce {
            0%, 18% { transform: translateY(0) rotate(0deg); }
            27%     { transform: translateY(-1.5px) rotate(-5deg); }
            36%     { transform: translateY(-3px) rotate(3deg); }
            45%     { transform: translateY(-1px) rotate(-3deg); }
            54%     { transform: translateY(0) rotate(2deg); }
            64%     { transform: translateY(-1px) rotate(-1.5deg); }
            74%     { transform: translateY(0) rotate(0.5deg); }
            82%, 100% { transform: translateY(0) rotate(0deg); }
          }
          @keyframes vexEyesOpen {
            0%, 30% { opacity: 1; }
            36%, 64% { opacity: 0; }
            70%, 100% { opacity: 1; }
          }
          @keyframes vexEyesShut {
            0%, 30% { opacity: 0; }
            36%, 64% { opacity: 1; }
            70%, 100% { opacity: 0; }
          }
          .vex-bot { animation: vexBounce 2s ease-in-out infinite; transform-origin: center center; }
          .vex-eyes-open { animation: vexEyesOpen 2s ease-in-out infinite; }
          .vex-eyes-shut { animation: vexEyesShut 2s ease-in-out infinite; }
        `}</style>
      )}
      <g className={animate ? "vex-bot" : undefined}>
        {/* 天线信号灯 */}
        <rect x="10.5" y="0.5" width="3" height="2.5" rx="0.5" fill="#34D399" />

        {/* 天线杆 */}
        <rect x="11.25" y="2.5" width="1.5" height="2.5" fill="#A78BFA" />

        {/* 左耳 */}
        <rect x="0.5" y="9" width="3" height="5" rx="1" fill="#6D28D9" />
        {/* 右耳 */}
        <rect x="20.5" y="9" width="3" height="5" rx="1" fill="#6D28D9" />

        {/* 头部主体 */}
        <rect x="3" y="5" width="18" height="16" rx="2.5" fill="#7C3AED" />

        {animate ? (
          <>
            {/* 像素方块眼 - 睁眼 */}
            <g className="vex-eyes-open">
              <rect x="7" y="9" width="3" height="4" rx="0.5" fill="#EDE9FE" />
              <rect x="14" y="9" width="3" height="4" rx="0.5" fill="#EDE9FE" />
            </g>

            {/* 横条眼 - 闭眼 */}
            <g className="vex-eyes-shut" style={{ opacity: 0 }}>
              <rect x="7" y="10.2" width="3" height="1.5" rx="0.5" fill="#EDE9FE" />
              <rect x="14" y="10.2" width="3" height="1.5" rx="0.5" fill="#EDE9FE" />
            </g>
          </>
        ) : (
          <>
            {/* 静止像素方块眼 */}
            <rect x="7" y="9" width="3" height="4" rx="0.5" fill="#EDE9FE" />
            <rect x="14" y="9" width="3" height="4" rx="0.5" fill="#EDE9FE" />
          </>
        )}

        {/* 像素嘴巴 */}
        <rect x="9.5" y="16" width="5" height="1.5" rx="0.5" fill="#EDE9FE" />
      </g>
    </svg>
  );
}

export function CouncilIcon({ size = 16, className = "", animate = false }) {
  return (
    <span
      className={`inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <CouncilSvg size={size} animate={animate} />
    </span>
  );
}

export function CouncilAvatar({ size = 24, animate = false }) {
  return (
    <span
      className="inline-flex items-center justify-center overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: "8px",
        background: "#F5F3FF",
      }}
    >
      <CouncilSvg size={size - 4} animate={animate} />
    </span>
  );
}
