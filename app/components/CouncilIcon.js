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
          @keyframes vexFloat {
            0%, 100% { transform: translateY(0) rotate(0deg); }
            25%       { transform: translateY(-1px) rotate(-1.5deg); }
            50%       { transform: translateY(-2px) rotate(0deg); }
            75%       { transform: translateY(-1px) rotate(1.5deg); }
          }
          @keyframes vexGlow {
            0%, 100% { opacity: 0.55; }
            50%      { opacity: 1; }
          }
          @keyframes vexEyesNormal {
            0%, 68% { opacity: 1; }
            74%, 88% { opacity: 0; }
            94%, 100% { opacity: 1; }
          }
          @keyframes vexEyesHappy {
            0%, 68% { opacity: 0; }
            74%, 88% { opacity: 1; }
            94%, 100% { opacity: 0; }
          }
          .vex-body   { animation: vexFloat 3s ease-in-out infinite; transform-origin: 12px 14px; }
          .vex-glow   { animation: vexGlow 2s ease-in-out infinite; }
          .vex-eyes-n { animation: vexEyesNormal 3.5s ease-in-out infinite; }
          .vex-eyes-h { animation: vexEyesHappy 3.5s ease-in-out infinite; }
        `}</style>
      )}
      <g className={animate ? "vex-body" : undefined}>
        {/* ── 耳朵（先画，层级在头部后面） ── */}
        <rect x="0.5" y="10.5" width="3" height="4.5" rx="1.5" fill="#6D28D9" />
        <rect x="20.5" y="10.5" width="3" height="4.5" rx="1.5" fill="#6D28D9" />

        {/* ── 头部主体 ── */}
        <rect x="3" y="6" width="18" height="16" rx="5.5" fill="#7C3AED" />

        {/* ── V 形天线 ── */}
        <path
          d="M9.5 6.5 L12 2.2 L14.5 6.5"
          fill="none"
          stroke="#A78BFA"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 天线顶端发光球 */}
        <circle
          cx="12"
          cy="2"
          r="1.3"
          fill="#34D399"
          className={animate ? "vex-glow" : undefined}
        />

        {/* ── 面部面板 ── */}
        <rect x="5.5" y="8.5" width="13" height="11" rx="3.5" fill="#EDE9FE" />

        {animate ? (
          <>
            {/* ●● 正常大眼睛（带高光） */}
            <g className="vex-eyes-n">
              <circle cx="9.2" cy="13" r="2.3" fill="#1E1B4B" />
              <circle cx="10" cy="12.1" r="0.75" fill="#fff" />
              <circle cx="14.8" cy="13" r="2.3" fill="#1E1B4B" />
              <circle cx="15.6" cy="12.1" r="0.75" fill="#fff" />
            </g>

            {/* ^_^ 开心眯眼 */}
            <g className="vex-eyes-h" style={{ opacity: 0 }}>
              <path d="M7.2 13.2 Q9.2 10.8 11.2 13.2" fill="none" stroke="#1E1B4B" strokeWidth="1.6" strokeLinecap="round" />
              <path d="M12.8 13.2 Q14.8 10.8 16.8 13.2" fill="none" stroke="#1E1B4B" strokeWidth="1.6" strokeLinecap="round" />
            </g>
          </>
        ) : (
          <>
            {/* 静止大眼睛 */}
            <circle cx="9.2" cy="13" r="2.3" fill="#1E1B4B" />
            <circle cx="10" cy="12.1" r="0.75" fill="#fff" />
            <circle cx="14.8" cy="13" r="2.3" fill="#1E1B4B" />
            <circle cx="15.6" cy="12.1" r="0.75" fill="#fff" />
          </>
        )}

        {/* ── 微笑嘴巴 ── */}
        <path
          d="M10 17 Q12 18.8 14 17"
          fill="none"
          stroke="#6D28D9"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
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
