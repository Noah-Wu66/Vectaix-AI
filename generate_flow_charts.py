import os

def create_svg(filename, content, width, height):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%">
    <defs>
        <style>
            .box {{ fill: #ffffff; stroke: #333333; stroke-width: 1.5; rx: 6; ry: 6; }}
            .box-council {{ fill: #e3f2fd; stroke: #1565c0; stroke-width: 1.5; rx: 8; ry: 8; }}
            .box-agent {{ fill: #fff3e0; stroke: #e65100; stroke-width: 1.5; rx: 8; ry: 8; }}
            .box-db {{ fill: #e8f5e9; stroke: #2e7d32; stroke-width: 1.5; rx: 6; ry: 6; }}
            .box-tool {{ fill: #f3e5f5; stroke: #7b1fa2; stroke-width: 1.5; rx: 6; ry: 6; }}
            .box-triage {{ fill: #fff8e1; stroke: #f9a825; stroke-width: 1.5; rx: 6; ry: 6; }}
            .text-main {{ font-family: "Times New Roman", Times, serif; font-size: 14px; font-weight: bold; text-anchor: middle; dominant-baseline: central; fill: #111; }}
            .text-sub {{ font-family: Arial, sans-serif; font-size: 12px; text-anchor: middle; dominant-baseline: central; fill: #333; }}
            .text-sm {{ font-family: Arial, sans-serif; font-size: 10px; font-style: italic; text-anchor: middle; dominant-baseline: central; fill: #555; }}
            .line {{ stroke: #555; stroke-width: 1.5; fill: none; }}
            .line-dash {{ stroke: #555; stroke-width: 1.5; fill: none; stroke-dasharray: 4,4; }}
        </style>
        <marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
            <path d="M0,0 L0,8 L8,4 z" fill="#555" />
        </marker>
    </defs>
    <rect width="100%" height="100%" fill="white"/>
    {content}
    </svg>'''
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(svg)

# Fig 1: System Overview
c1 = []
c1.append('<rect x="40" y="100" width="340" height="130" class="box-council" />')
c1.append('<text x="210" y="115" class="text-main">Council Engine</text>')

c1.append('<rect x="460" y="100" width="340" height="130" class="box-agent" />')
c1.append('<text x="630" y="115" class="text-main">Agent Engine</text>')

c1.append('<rect x="320" y="20" width="200" height="40" class="box" />')
c1.append('<text x="420" y="40" class="text-main">Client (React 19 + SSE)</text>')

c1.append('<rect x="60" y="140" width="80" height="30" class="box" />')
c1.append('<text x="100" y="155" class="text-sub">Seed Triage</text>')
c1.append('<rect x="170" y="140" width="120" height="30" class="box" />')
c1.append('<text x="230" y="155" class="text-sub">Parallel Experts (×3)</text>')
c1.append('<rect x="200" y="190" width="100" height="30" class="box" />')
c1.append('<text x="250" y="205" class="text-sub">Seed Synthesis</text>')

c1.append('<path d="M 140,155 L 170,155" class="line" marker-end="url(#arrow)" />')
c1.append('<path d="M 230,170 L 250,190" class="line" marker-end="url(#arrow)" />')

c1.append('<rect x="480" y="140" width="60" height="30" class="box" />')
c1.append('<text x="510" y="155" class="text-sub">Planner</text>')
c1.append('<rect x="560" y="140" width="80" height="30" class="box" />')
c1.append('<text x="600" y="155" class="text-sub">Att. Reader</text>')
c1.append('<rect x="660" y="140" width="120" height="30" class="box" />')
c1.append('<text x="720" y="155" class="text-sub">Tool Loop (ReAct)</text>')
c1.append('<rect x="670" y="190" width="100" height="30" class="box" />')
c1.append('<text x="720" y="205" class="text-sub">Answer Writer</text>')

c1.append('<path d="M 540,155 L 560,155" class="line" marker-end="url(#arrow)" />')
c1.append('<path d="M 640,155 L 660,155" class="line" marker-end="url(#arrow)" />')
c1.append('<path d="M 720,170 L 720,190" class="line" marker-end="url(#arrow)" />')

c1.append('<rect x="370" y="270" width="100" height="40" class="box-db" />')
c1.append('<text x="420" y="290" class="text-main" fill="#2e7d32">MongoDB</text>')

c1.append('<rect x="520" y="270" width="100" height="40" class="box-tool" />')
c1.append('<text x="570" y="290" class="text-main" fill="#7b1fa2">Tool Registry</text>')
c1.append('<rect x="660" y="255" width="100" height="30" class="box-tool" />')
c1.append('<text x="710" y="270" class="text-sub">Web Browsing</text>')
c1.append('<rect x="660" y="295" width="100" height="30" class="box-tool" />')
c1.append('<text x="710" y="310" class="text-sub">Vercel Sandbox</text>')

c1.append('<path d="M 620,290 L 660,270" class="line" marker-end="url(#arrow)" />')
c1.append('<path d="M 620,290 L 660,310" class="line" marker-end="url(#arrow)" />')

c1.append('<path d="M 370,60 L 210,100" class="line" marker-end="url(#arrow)" />')
c1.append('<text x="250" y="65" class="text-sm" transform="rotate(-20 250 65)">POST /api/council</text>')
c1.append('<path d="M 470,60 L 630,100" class="line" marker-end="url(#arrow)" />')
c1.append('<text x="590" y="65" class="text-sm" transform="rotate(20 590 65)">POST /api/agent</text>')

c1.append('<path d="M 210,230 L 370,290" class="line" marker-end="url(#arrow)" />')
c1.append('<path d="M 630,230 L 470,290" class="line" marker-end="url(#arrow)" />')
c1.append('<path d="M 630,230 L 570,270" class="line" marker-end="url(#arrow)" />')

create_svg("public/images/architecture/fig1_system_overview.svg", "\n".join(c1), 840, 340)

# Fig 2: Pipeline Architecture
c2 = []
c2.append('<rect x="20" y="140" width="100" height="40" class="box" />')
c2.append('<text x="70" y="160" class="text-main">User Query Q</text>')

c2.append('<rect x="160" y="120" width="160" height="80" class="box-triage" />')
c2.append('<text x="240" y="140" class="text-main">Phase 1: Seed Triage</text>')
c2.append('<text x="240" y="160" class="text-sm">Seed 2.0 Pro (minimal)</text>')
c2.append('<text x="240" y="175" class="text-sm">Output: {needCouncil}</text>')

c2.append('<rect x="160" y="240" width="160" height="40" class="box" stroke="#c62828" />')
c2.append('<text x="240" y="260" class="text-main">Direct Answer</text>')

c2.append('<rect x="360" y="40" width="220" height="240" class="box-council" />')
c2.append('<text x="470" y="60" class="text-main">Phase 2: Parallel Experts</text>')

c2.append('<rect x="380" y="80" width="180" height="50" class="box" />')
c2.append('<text x="470" y="95" class="text-sub">Expert 1: GPT-5.4</text>')
c2.append('<text x="470" y="115" class="text-sm">Web Search → CoT → R₁</text>')

c2.append('<rect x="380" y="140" width="180" height="50" class="box" />')
c2.append('<text x="470" y="155" class="text-sub">Expert 2: Claude Opus 4.6</text>')
c2.append('<text x="470" y="175" class="text-sm">Web Search → CoT → R₂</text>')

c2.append('<rect x="380" y="200" width="180" height="50" class="box" />')
c2.append('<text x="470" y="215" class="text-sub">Expert 3: Gemini 3.1 Pro</text>')
c2.append('<text x="470" y="235" class="text-sm">Web Search → CoT → R₃</text>')

c2.append('<rect x="620" y="110" width="200" height="100" class="box-db" />')
c2.append('<text x="720" y="130" class="text-main">Phase 3: Seed Synthesis</text>')
c2.append('<text x="720" y="150" class="text-sm">Seed 2.0 Pro (high)</text>')
c2.append('<text x="720" y="170" class="text-sm">Payload: Prompt + R₁ + R₂ + R₃</text>')
c2.append('<text x="720" y="190" class="text-sm">Output: 4-Section Consensus</text>')

c2.append('<rect x="640" y="250" width="160" height="40" class="box" stroke="#1b5e20" stroke-width="2" />')
c2.append('<text x="720" y="270" class="text-main">Consensus Response A</text>')

c2.append('<path d="M 120,160 L 160,160" class="line" marker-end="url(#arrow)" />')
c2.append('<path d="M 240,200 L 240,240" class="line-dash" marker-end="url(#arrow)" />')
c2.append('<text x="245" y="220" class="text-sm" text-anchor="start">needCouncil=false</text>')

c2.append('<path d="M 320,160 L 360,160" class="line" marker-end="url(#arrow)" />')
c2.append('<text x="340" y="150" class="text-sm">true</text>')

c2.append('<path d="M 560,105 L 620,130" class="line" marker-end="url(#arrow)" />')
c2.append('<path d="M 560,165 L 620,165" class="line" marker-end="url(#arrow)" />')
c2.append('<path d="M 560,225 L 620,200" class="line" marker-end="url(#arrow)" />')

c2.append('<path d="M 720,210 L 720,250" class="line" marker-end="url(#arrow)" />')

create_svg("public/images/architecture/fig2_pipeline_arch.svg", "\n".join(c2), 840, 320)

# Fig 5: Agent Pipeline
c3 = []
c3.append('<rect x="20" y="140" width="120" height="40" class="box" />')
c3.append('<text x="80" y="160" class="text-main">POST /api/agent</text>')

c3.append('<rect x="180" y="140" width="120" height="40" class="box" />')
c3.append('<text x="240" y="152" class="text-main">Auth + Rate Limit</text>')
c3.append('<text x="240" y="168" class="text-sm">(20 req/min)</text>')

c3.append('<rect x="340" y="140" width="120" height="40" class="box" />')
c3.append('<text x="400" y="160" class="text-main">Coordinator.init()</text>')

c3.append('<rect x="500" y="40" width="320" height="240" class="box-agent" />')
c3.append('<text x="660" y="60" class="text-main">Instruction Engine — 4 Phases</text>')

c3.append('<rect x="520" y="80" width="120" height="40" class="box" stroke="#2e7d32" />')
c3.append('<text x="580" y="100" class="text-sub">P1: Planner (Regex)</text>')

c3.append('<rect x="680" y="80" width="120" height="40" class="box" stroke="#1565c0" />')
c3.append('<text x="740" y="100" class="text-sub">P2: Attach. Reader</text>')

c3.append('<rect x="520" y="160" width="280" height="40" class="box" stroke="#c62828" />')
c3.append('<text x="660" y="180" class="text-sub">P3: Tool Loop (ReAct, max 4 rounds)</text>')

c3.append('<rect x="520" y="220" width="280" height="40" class="box" stroke="#7b1fa2" />')
c3.append('<text x="660" y="240" class="text-sub">P4: Answer Writer (Streaming)</text>')

c3.append('<rect x="540" y="310" width="240" height="40" class="box-db" />')
c3.append('<text x="660" y="330" class="text-main">MongoDB (Memory & State Serialize)</text>')

c3.append('<path d="M 140,160 L 180,160" class="line" marker-end="url(#arrow)" />')
c3.append('<path d="M 300,160 L 340,160" class="line" marker-end="url(#arrow)" />')
c3.append('<path d="M 460,160 L 500,160" class="line" marker-end="url(#arrow)" />')

c3.append('<path d="M 640,100 L 680,100" class="line" marker-end="url(#arrow)" />')
c3.append('<path d="M 740,120 L 740,140 L 660,140 L 660,160" class="line" marker-end="url(#arrow)" />')
c3.append('<path d="M 660,200 L 660,220" class="line" marker-end="url(#arrow)" />')
c3.append('<path d="M 660,260 L 660,310" class="line-dash" marker-end="url(#arrow)" />')

create_svg("public/images/architecture/fig5_agent_pipeline.svg", "\n".join(c3), 840, 380)

# Fig 7: Web Browsing Loop
c4 = []
c4.append('<rect x="20" y="20" width="800" height="235" class="box-council" />')
c4.append('<text x="420" y="32" class="text-main">Web Browsing Session (max 5 rounds)</text>')

c4.append('<rect x="50" y="80" width="160" height="80" class="box" />')
c4.append('<text x="130" y="110" class="text-main">LLM Action Decision</text>')
c4.append('<text x="130" y="130" class="text-sub">(via actionRunner)</text>')

c4.append('<rect x="300" y="60" width="200" height="40" class="box" />')
c4.append('<text x="400" y="80" class="text-sub">Volcengine Search (Max 20)</text>')

c4.append('<rect x="300" y="110" width="200" height="40" class="box" />')
c4.append('<text x="400" y="130" class="text-sub">Fetch Single URL (20s limit)</text>')

c4.append('<rect x="300" y="160" width="200" height="40" class="box" />')
c4.append('<text x="400" y="180" class="text-sub">Batch Fetch URLs (3 conc)</text>')

c4.append('<rect x="620" y="110" width="120" height="40" class="box" stroke="#1b5e20" stroke-width="2" />')
c4.append('<text x="680" y="130" class="text-main">Exit Loop</text>')

c4.append('<path d="M 210,90 L 300,80" class="line" marker-end="url(#arrow)" />')
c4.append('<text x="250" y="75" class="text-sm">"search"</text>')
c4.append('<path d="M 210,120 L 300,130" class="line" marker-end="url(#arrow)" />')
c4.append('<text x="255" y="115" class="text-sm">"crawlSingle"</text>')
c4.append('<path d="M 210,150 L 300,180" class="line" marker-end="url(#arrow)" />')
c4.append('<text x="260" y="148" class="text-sm">"crawlMulti"</text>')

c4.append('<path d="M 500,80 L 540,80 L 540,45 L 130,45 L 130,80" class="line-dash" marker-end="url(#arrow)" />')
c4.append('<path d="M 500,130 L 520,130 L 520,45" class="line-dash" />')
c4.append('<path d="M 500,180 L 530,180 L 530,45" class="line-dash" />')

c4.append('<path d="M 130,160 L 130,235 L 680,235 L 680,150" class="line" marker-end="url(#arrow)" />')
c4.append('<text x="420" y="215" class="text-sm">"final_answer"</text>')

create_svg("public/images/architecture/fig7_browsing_loop.svg", "\n".join(c4), 840, 260)

print("Flow SVGs generated.")