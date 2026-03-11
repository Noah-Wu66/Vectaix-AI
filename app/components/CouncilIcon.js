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
          @keyframes councilBounce {
            0%, 18% { transform: translateY(0) rotate(0deg); }
            27%     { transform: translateY(-1.5px) rotate(-6deg); }
            36%     { transform: translateY(-3px) rotate(3deg); }
            45%     { transform: translateY(-1px) rotate(-4deg); }
            54%     { transform: translateY(0) rotate(2deg); }
            64%     { transform: translateY(-1.2px) rotate(-2deg); }
            74%     { transform: translateY(0) rotate(1deg); }
            82%, 100% { transform: translateY(0) rotate(0deg); }
          }
          @keyframes eyesNormal {
            0%, 16% { opacity: 1; }
            20%, 70% { opacity: 0; }
            76%, 100% { opacity: 1; }
          }
          @keyframes eyesEffort {
            0%, 16% { opacity: 0; }
            20%, 46% { opacity: 1; }
            50%, 100% { opacity: 0; }
          }
          @keyframes eyesHappy {
            0%, 46% { opacity: 0; }
            50%, 70% { opacity: 1; }
            76%, 100% { opacity: 0; }
          }
          .council-bot { animation: councilBounce 2s ease-in-out infinite; transform-origin: center center; }
          .eyes-normal { animation: eyesNormal 2s ease-in-out infinite; }
          .eyes-effort { animation: eyesEffort 2s ease-in-out infinite; }
          .eyes-happy  { animation: eyesHappy  2s ease-in-out infinite; }
        `}</style>
      )}
      <g className={animate ? "council-bot" : undefined}>
        {/* 橙色身体（evenodd 挖空眼睛区域） */}
        <path
          clipRule="evenodd"
          fillRule="evenodd"
          fill="#D97757"
          d="M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z"
        />

        {animate ? (
          <>
            {/* 用橙色填充眼洞，这样表情切换时不会露出背景 */}
            <rect x="6" y="8.102" width="1.488" height="2.847" fill="#D97757" />
            <rect x="16.51" y="8.102" width="1.49" height="2.847" fill="#D97757" />

            {/* ■■ 普通眼睛（方块） */}
            <g className="eyes-normal">
              <rect x="6" y="8.102" width="1.488" height="2.847" fill="#000" />
              <rect x="16.51" y="8.102" width="1.49" height="2.847" fill="#000" />
            </g>

            {/* >< 用力表情 */}
            <g className="eyes-effort" style={{ opacity: 0 }}>
              <polyline points="6.2,8.4 7.3,9.5 6.2,10.6" fill="none" stroke="#000" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="17.8,8.4 16.7,9.5 17.8,10.6" fill="none" stroke="#000" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </g>

            {/* ∧∧ 开心表情 */}
            <g className="eyes-happy" style={{ opacity: 0 }}>
              <polyline points="6,10.3 6.74,8.5 7.5,10.3" fill="none" stroke="#000" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <polyline points="16.5,10.3 17.25,8.5 18,10.3" fill="none" stroke="#000" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </>
        ) : (
          <>
            {/* 静止时的黑色眼睛 */}
            <rect x="6" y="8.102" width="1.488" height="2.847" fill="#000" />
            <rect x="16.51" y="8.102" width="1.49" height="2.847" fill="#000" />
          </>
        )}
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
        background: "#F4E3DB",
      }}
    >
      <CouncilSvg size={size - 4} animate={animate} />
    </span>
  );
}
