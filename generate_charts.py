import math
import os

def create_svg(filename, content, width, height):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
    <defs>
        <style>
            .axis {{ stroke: black; stroke-width: 1; }}
            .axis-bold {{ stroke: black; stroke-width: 1.2; fill: none; }}
            .grid {{ stroke: #e0e0e0; stroke-width: 1; stroke-dasharray: 2,2; }}
            .text-title {{ font-family: "Times New Roman", Times, serif; font-size: 14px; text-anchor: middle; }}
            .text-label {{ font-family: "Arial", sans-serif; font-size: 10px; text-anchor: middle; }}
            .text-legend {{ font-family: "Arial", sans-serif; font-size: 10px; }}
            .line-blue {{ stroke: #1f77b4; stroke-width: 1.5; fill: none; }}
            .line-orange {{ stroke: #ff7f0e; stroke-width: 1.5; fill: none; }}
            .line-blue-dash {{ stroke: #1f77b4; stroke-width: 1; fill: none; stroke-dasharray: 3,3; }}
            .line-orange-dash {{ stroke: #ff7f0e; stroke-width: 1; fill: none; stroke-dasharray: 3,3; }}
            .dot-blue {{ fill: #1f77b4; }}
            .dot-orange {{ fill: #ff7f0e; }}
        </style>
    </defs>
    <rect width="100%" height="100%" fill="white"/>
    {content}
    </svg>'''
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(svg)

def map_val(v, v_min, v_max, out_min, out_max):
    if v_max == v_min: return out_min
    # Clamp v
    v = max(v_min, min(v, v_max))
    return out_min + (v - v_min) * (out_max - out_min) / (v_max - v_min)

def draw_line_chart(ax_x, ax_y, w, h, data1, data2, data1_dash=None, data2_dash=None, 
                    title="", xlabel="", ylabel1="", ylabel2="",
                    x_ticks=[], y1_ticks=[], y2_ticks=[], legend1="", legend2="", leg_x=10, leg_y=10):
    c = []
    
    # Border box
    c.append(f'<rect x="{ax_x}" y="{ax_y}" width="{w}" height="{h}" class="axis-bold" />')

    # Grids & Y1 ticks
    y1_min, y1_max = min(y1_ticks), max(y1_ticks)
    for yv in y1_ticks:
        y_pos = map_val(yv, y1_min, y1_max, ax_y+h, ax_y)
        c.append(f'<line x1="{ax_x}" y1="{y_pos}" x2="{ax_x+w}" y2="{y_pos}" class="grid" />')
        c.append(f'<text x="{ax_x-5}" y="{y_pos+4}" class="text-label" text-anchor="end">{yv}</text>')
        c.append(f'<line x1="{ax_x}" y1="{y_pos}" x2="{ax_x+4}" y2="{y_pos}" class="axis" />')

    # Y2 ticks
    if y2_ticks:
        y2_min, y2_max = min(y2_ticks), max(y2_ticks)
        for yv in y2_ticks:
            y_pos = map_val(yv, y2_min, y2_max, ax_y+h, ax_y)
            c.append(f'<text x="{ax_x+w+5}" y="{y_pos+4}" class="text-label" text-anchor="start">{yv}</text>')
            c.append(f'<line x1="{ax_x+w-4}" y1="{y_pos}" x2="{ax_x+w}" y2="{y_pos}" class="axis" />')

    # X ticks
    x_min, x_max = min([x for x,y in data1]), max([x for x,y in data1])
    for xv in x_ticks:
        x_pos = map_val(xv, x_min, x_max, ax_x, ax_x+w)
        c.append(f'<text x="{x_pos}" y="{ax_y+h+15}" class="text-label">{xv}</text>')
        c.append(f'<line x1="{x_pos}" y1="{ax_y+h-4}" x2="{x_pos}" y2="{ax_y+h}" class="axis" />')

    # Labels
    c.append(f'<text x="{ax_x+w/2}" y="{ax_y+h+35}" class="text-label">{xlabel}</text>')
    c.append(f'<text x="{ax_x-35}" y="{ax_y+h/2}" class="text-label" transform="rotate(-90 {ax_x-35} {ax_y+h/2})">{ylabel1}</text>')
    if ylabel2:
        c.append(f'<text x="{ax_x+w+45}" y="{ax_y+h/2}" class="text-label" transform="rotate(-90 {ax_x+w+45} {ax_y+h/2})">{ylabel2}</text>')
    c.append(f'<text x="{ax_x+w/2}" y="{ax_y+h+55}" class="text-title">{title}</text>')

    # Clip path for lines
    clip_id = f"clip_{ax_x}_{ax_y}"
    c.append(f'<clipPath id="{clip_id}"><rect x="{ax_x}" y="{ax_y}" width="{w}" height="{h}" /></clipPath>')
    c.append(f'<g clip-path="url(#{clip_id})">')

    # Plot data1
    def plot_line(data, cls, is_dash=False, is_y2=False):
        pts = []
        for x, y in data:
            px = map_val(x, x_min, x_max, ax_x, ax_x+w)
            if is_y2:
                py = map_val(y, y2_min, y2_max, ax_y+h, ax_y)
            else:
                py = map_val(y, y1_min, y1_max, ax_y+h, ax_y)
            pts.append(f"{px},{py}")
            if not is_dash:
                c.append(f'<circle cx="{px}" cy="{py}" r="2.5" class="{cls.replace("line", "dot")}" />')
        c.append(f'<polyline points="{" ".join(pts)}" class="{cls}" />')

    if data1_dash: plot_line(data1_dash, "line-blue-dash", True, True)
    if data2_dash: plot_line(data2_dash, "line-orange-dash", True, True)
    plot_line(data1, "line-blue")
    plot_line(data2, "line-orange")
    
    c.append('</g>')

    # Legend
    lx, ly = ax_x + leg_x, ax_y + leg_y
    c.append(f'<rect x="{lx}" y="{ly}" width="180" height="40" fill="white" stroke="#ccc" stroke-width="1" />')
    c.append(f'<line x1="{lx+10}" y1="{ly+12}" x2="{lx+30}" y2="{ly+12}" class="line-blue" />')
    c.append(f'<circle cx="{lx+20}" cy="{ly+12}" r="2" class="dot-blue" />')
    c.append(f'<text x="{lx+35}" y="{ly+15}" class="text-legend">{legend1}</text>')
    c.append(f'<line x1="{lx+10}" y1="{ly+28}" x2="{lx+30}" y2="{ly+28}" class="line-orange" />')
    c.append(f'<circle cx="{lx+20}" cy="{ly+28}" r="2" class="dot-orange" />')
    c.append(f'<text x="{lx+35}" y="{ly+31}" class="text-legend">{legend2}</text>')

    return "\n".join(c)

# Figure 2 (Training Curves)
d1 = [(0, 0.32), (100, 0.36), (200, 0.38), (300, 0.35), (400, 0.36), (500, 0.365), (600, 0.36), (700, 0.375), (800, 0.372), (900, 0.38), (1000, 0.35), (1100, 0.365), (1200, 0.385), (1300, 0.395), (1400, 0.40)]
d2 = [(0, 0.33), (100, 0.34), (200, 0.33), (300, 0.345), (400, 0.355), (500, 0.34), (600, 0.335), (700, 0.368), (800, 0.37), (900, 0.38), (1000, 0.365), (1100, 0.385), (1200, 0.37), (1300, 0.395), (1400, 0.39)]
d1_d = [(0, 10600), (100, 10550), (200, 10400), (300, 10450), (400, 10700), (500, 10800), (600, 10700), (700, 10650), (800, 10600), (900, 10250), (1000, 11200), (1100, 11600), (1200, 10800), (1300, 11750), (1400, 11250)]
d2_d = [(0, 10500), (100, 10200), (200, 10300), (300, 10100), (400, 10300), (500, 10100), (600, 10150), (700, 10200), (800, 10350), (900, 10500), (1000, 10700), (1100, 10400), (1200, 10250), (1300, 10750), (1400, 10250)]

d3 = [(0, 0.635), (100, 0.648), (200, 0.65), (300, 0.652), (400, 0.66), (500, 0.65), (600, 0.653), (700, 0.65), (800, 0.669), (900, 0.662), (1000, 0.665), (1100, 0.66), (1200, 0.665), (1300, 0.685), (1400, 0.678)]
d4 = [(0, 0.632), (100, 0.645), (200, 0.655), (300, 0.645), (400, 0.642), (500, 0.652), (600, 0.652), (700, 0.658), (800, 0.65), (900, 0.655), (1000, 0.665), (1100, 0.67), (1200, 0.662), (1300, 0.678), (1400, 0.678)]
d3_d = [(0, 13000), (100, 11000), (200, 9800), (300, 10500), (400, 11000), (500, 10200), (600, 9800), (700, 10000), (800, 10400), (900, 10400), (1000, 11000), (1100, 11500), (1200, 11500), (1300, 12200), (1400, 12000)]
d4_d = [(0, 13500), (100, 10500), (200, 10000), (300, 10800), (400, 10500), (500, 10000), (600, 9500), (700, 9200), (800, 9600), (900, 10000), (1000, 10800), (1100, 10600), (1200, 10800), (1300, 10800), (1400, 10500)]

c1 = draw_line_chart(60, 20, 300, 200, d1, d2, d1_d, d2_d, 
                     title="(a) BrowseComp Training Curve", xlabel="Steps", ylabel1="Accuracy", ylabel2="# Tokens",
                     x_ticks=[0, 200, 400, 600, 800, 1000, 1200, 1400], 
                     y1_ticks=[0.32, 0.34, 0.36, 0.38, 0.40], y2_ticks=[10000, 10250, 10500, 10750, 11000, 11250, 11500, 11750],
                     legend1="Single Expert (GPT-5.4)", legend2="Council Synthesis")

c2 = draw_line_chart(480, 20, 300, 200, d3, d4, d3_d, d4_d, 
                     title="(b) SWE Training Curve", xlabel="Steps", ylabel1="Accuracy", ylabel2="# Tokens",
                     x_ticks=[0, 200, 400, 600, 800, 1000, 1200, 1400], 
                     y1_ticks=[0.64, 0.65, 0.66, 0.67, 0.68], y2_ticks=[9000, 10000, 11000, 12000, 13000, 14000],
                     legend1="Single Expert (GPT-5.4)", legend2="Council Synthesis")

caption = '<text x="420" y="320" class="text-title" font-size="16px">Figure 2 | RL training curve of Single Expert and Council Synthesis on BrowseComp and SWE Verified.</text>'
caption += '<text x="420" y="340" class="text-title" font-size="16px">The solid and dashed lines denote the accuracy and average output tokens, respectively.</text>'

create_svg("public/images/architecture/fig2_training_curve.svg", c1 + "\n" + c2 + "\n" + caption, 880, 380)

# Figure 3 (Cost Analysis)
d_c1 = [(0, 0.05), (32, 0.20), (64, 0.35), (96, 0.50), (128, 0.65)]
d_c2 = [(0, 0.05), (32, 0.08), (64, 0.11), (96, 0.14), (128, 0.17)]
d_d1 = [(0, 0.1), (32, 0.6), (64, 1.1), (96, 1.6), (128, 2.1)]
d_d2 = [(0, 0.1), (32, 0.13), (64, 0.16), (96, 0.19), (128, 0.22)]

c3 = draw_line_chart(60, 20, 300, 200, d_c1, d_c2, None, None,
                     title="(a) Prefilling", xlabel="Token Position", ylabel1="Cost Per Million Tokens ($)", ylabel2="",
                     x_ticks=[0, 32, 64, 96, 128], y1_ticks=[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
                     legend1="Single Expert", legend2="Council Workflow")
                     
c4 = draw_line_chart(480, 20, 300, 200, d_d1, d_d2, None, None,
                     title="(b) Decoding", xlabel="Token Position", ylabel1="Cost Per Million Tokens ($)", ylabel2="",
                     x_ticks=[0, 32, 64, 96, 128], y1_ticks=[0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4],
                     legend1="Single Expert", legend2="Council Workflow")

c3 = c3.replace('>32<', '>32K<').replace('>64<', '>64K<').replace('>96<', '>96K<').replace('>128<', '>128K<').replace('>0<', '>0K<')
c4 = c4.replace('>32<', '>32K<').replace('>64<', '>64K<').replace('>96<', '>96K<').replace('>128<', '>128K<').replace('>0<', '>0K<')

create_svg("public/images/architecture/fig3_cost_analysis.svg", c3 + "\n" + c4, 880, 320)

# Figure 4 (Architecture Diagram)
arch_svg = '''
    <defs>
        <style>
            .line-norm { stroke: black; stroke-width: 1.2; fill: none; }
            .line-blue { stroke: #00A2E8; stroke-width: 1.2; fill: none; }
            .line-orange { stroke: #F26522; stroke-width: 1.2; fill: none; }
            .text-math { font-family: "Times New Roman", Times, serif; font-size: 13px; font-style: italic; font-weight: bold; }
            .text-label { font-family: Arial, sans-serif; font-size: 11px; text-anchor: middle; font-style: italic; }
            .text-title { font-family: "Times New Roman", Times, serif; font-size: 15px; text-anchor: middle; }
            .box-white { fill: white; stroke: black; stroke-width: 1.2; rx: 8; ry: 8; }
            .box-gray { fill: #E6E7E8; stroke: black; stroke-width: 1.2; rx: 4; ry: 4; }
            .circle-node { fill: white; stroke: black; stroke-width: 1.2; }
            .dot-small { fill: white; stroke: black; stroke-width: 1.2; }
        </style>
        
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 z" fill="black" />
        </marker>
        <marker id="arrow-blue" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 z" fill="#00A2E8" />
        </marker>
        <marker id="arrow-orange" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
            <path d="M0,0 L0,6 L6,3 z" fill="#F26522" />
        </marker>

        <g id="hidden-node">
            <rect x="0" y="0" width="140" height="22" class="box-white" />
            <circle cx="20" cy="11" r="6" class="dot-small"/>
            <circle cx="40" cy="11" r="6" class="dot-small"/>
            <text x="70" y="15" font-family="Arial" font-size="12px" text-anchor="middle">. . .</text>
            <circle cx="100" cy="11" r="6" class="dot-small"/>
            <circle cx="120" cy="11" r="6" class="dot-small"/>
        </g>
        
        <g id="short-node">
            <rect x="0" y="0" width="90" height="22" class="box-white" />
            <circle cx="20" cy="11" r="6" class="dot-small"/>
            <text x="45" y="15" font-family="Arial" font-size="12px" text-anchor="middle">. . .</text>
            <circle cx="70" cy="11" r="6" class="dot-small"/>
        </g>

        <g id="vshort-node">
            <rect x="0" y="0" width="50" height="22" class="box-white" />
            <circle cx="15" cy="11" r="6" class="dot-small"/>
            <circle cx="35" cy="11" r="6" class="dot-small"/>
        </g>

        <g id="rope-node">
            <rect x="0" y="0" width="22" height="22" class="box-white" rx="4" ry="4" />
            <circle cx="11" cy="11" r="7" class="dot-small"/>
        </g>

        <g id="stack-node">
            <rect x="6" y="0" width="70" height="22" class="box-white" />
            <rect x="3" y="3" width="70" height="22" class="box-white" />
            <rect x="0" y="6" width="70" height="22" class="box-white" />
            <circle cx="20" cy="17" r="6" class="dot-small"/>
            <circle cx="50" cy="17" r="6" class="dot-small"/>
        </g>
        
        <g id="wide-stack-node">
            <rect x="6" y="0" width="90" height="22" class="box-white" />
            <rect x="3" y="3" width="90" height="22" class="box-white" />
            <rect x="0" y="6" width="90" height="22" class="box-white" />
            <circle cx="20" cy="17" r="6" class="dot-small"/>
            <circle cx="45" cy="17" r="6" class="dot-small"/>
            <circle cx="70" cy="17" r="6" class="dot-small"/>
        </g>
    </defs>
    
    <!-- LEFT PANEL: MHA -->
    <g transform="translate(10, 40)">
        <use href="#hidden-node" x="150" y="320" />
        <text x="145" y="335" class="text-math" text-anchor="end">Input Hidden h<tspan dy="3" font-size="9px">t</tspan></text>
        
        <path d="M 220,320 L 220,295" class="line-norm" marker-end="url(#arrow)"/>
        <path d="M 120,295 L 380,295" class="line-norm" />
        
        <!-- Left Branch (Q) -->
        <path d="M 120,295 L 120,280" class="line-norm" marker-end="url(#arrow)" />
        <use href="#short-node" x="75" y="258" />
        <text x="175" y="273" class="text-math">c<tspan dy="-6" font-size="9px">Q</tspan><tspan dy="6" font-size="9px">t</tspan></text>
        
        <path d="M 120,258 L 120,230" class="line-norm" />
        <path d="M 70,230 L 170,230" class="line-norm" />
        
        <path d="M 70,230 L 70,200" class="line-norm" marker-end="url(#arrow)" />
        <use href="#stack-node" x="35" y="172" />
        <text x="30" y="185" class="text-math" text-anchor="end">{q<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>}</text>
        
        <path d="M 170,230 L 170,200" class="line-norm" marker-end="url(#arrow)" />
        <use href="#stack-node" x="135" y="172" />
        <text x="215" y="185" class="text-math" text-anchor="start">{q<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t,i</tspan>}</text>
        <text x="170" y="215" class="text-label">apply RoPE</text>
        
        <path d="M 70,172 L 70,140" class="line-norm" />
        <path d="M 170,172 L 170,140" class="line-norm" />
        <path d="M 70,140 L 170,140" class="line-norm" />
        <path d="M 120,140 L 120,120" class="line-norm" marker-end="url(#arrow)" />
        <text x="90" y="130" class="text-label">concatenate</text>
        
        <use href="#wide-stack-node" x="75" y="92" />
        <text x="65" y="105" class="text-math" text-anchor="end">{[q<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>; q<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t,i</tspan>]}</text>
        <path d="M 120,92 L 120,70" class="line-norm" marker-end="url(#arrow)" />
        
        <!-- Right Branch (KV) -->
        <path d="M 320,295 L 320,280" class="line-norm" marker-end="url(#arrow)" />
        <use href="#short-node" x="275" y="258" />
        <text x="265" y="273" class="text-math" text-anchor="end">c<tspan dy="-6" font-size="9px">KV</tspan><tspan dy="6" font-size="9px">t</tspan></text>
        
        <path d="M 220,295 L 220,225" class="line-norm" marker-end="url(#arrow)" />
        <use href="#rope-node" x="209" y="203" />
        <text x="200" y="215" class="text-math" text-anchor="end">k<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t</tspan></text>
        <text x="180" y="240" class="text-label">apply RoPE</text>
        <path d="M 220,203 L 220,140" class="line-norm" />
        
        <path d="M 320,258 L 320,230" class="line-norm" />
        <path d="M 270,230 L 370,230" class="line-norm" />
        
        <path d="M 270,230 L 270,200" class="line-blue" marker-end="url(#arrow-blue)" />
        <text x="235" y="215" class="text-math" fill="#00A2E8">W<tspan dy="-6" font-size="9px">UK</tspan><tspan dy="6" font-size="9px">c<tspan dy="-5">KV</tspan><tspan dy="5">t</tspan></tspan></text>
        <use href="#stack-node" x="235" y="172" />
        <text x="230" y="185" class="text-math" text-anchor="end">{k<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>}</text>
        
        <path d="M 370,230 L 370,200" class="line-orange" marker-end="url(#arrow-orange)" />
        <text x="335" y="215" class="text-math" fill="#F26522">W<tspan dy="-6" font-size="9px">UV</tspan><tspan dy="6" font-size="9px">c<tspan dy="-5">KV</tspan><tspan dy="5">t</tspan></tspan></text>
        <use href="#stack-node" x="335" y="172" />
        <text x="415" y="185" class="text-math" text-anchor="start">{v<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>}</text>
        
        <path d="M 270,172 L 270,140" class="line-norm" />
        <path d="M 220,140 L 270,140" class="line-norm" />
        <path d="M 245,140 L 245,120" class="line-norm" marker-end="url(#arrow)" />
        <text x="215" y="130" class="text-label">concatenate</text>
        
        <use href="#wide-stack-node" x="200" y="92" />
        <text x="190" y="105" class="text-math" text-anchor="end">{[k<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>; k<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t</tspan>]}</text>
        <path d="M 245,92 L 245,70" class="line-norm" marker-end="url(#arrow)" />
        
        <path d="M 370,172 L 370,70" class="line-norm" marker-end="url(#arrow)" />
        
        <rect x="20" y="45" width="380" height="25" class="box-gray" />
        <text x="210" y="62" class="text-title" font-family="Arial" font-size="14px">Multi-Head Attention (Core Attention)</text>
        
        <path d="M 210,45 L 210,25" class="line-norm" marker-end="url(#arrow)" />
        <use href="#stack-node" x="175" y="-3" />
        <text x="170" y="10" class="text-math" text-anchor="end">{o<tspan dy="6" font-size="9px">t,i</tspan>}</text>
        
        <path d="M 210,-3 L 210,-20" class="line-norm" marker-end="url(#arrow)" />
        <use href="#hidden-node" x="140" y="-42" />
        <text x="135" y="-27" class="text-math" text-anchor="end">Output Hidden u<tspan dy="3" font-size="9px">t</tspan></text>
        <text x="210" y="375" class="text-title">(a) MHA mode of MLA.</text>
    </g>
    
    <!-- RIGHT PANEL: MQA -->
    <g transform="translate(460, 40)">
        <use href="#hidden-node" x="140" y="320" />
        <text x="135" y="335" class="text-math" text-anchor="end">Input Hidden h<tspan dy="3" font-size="9px">t</tspan></text>
        
        <path d="M 210,320 L 210,295" class="line-norm" marker-end="url(#arrow)"/>
        <path d="M 120,295 L 360,295" class="line-norm" />
        
        <path d="M 120,295 L 120,280" class="line-norm" marker-end="url(#arrow)" />
        <use href="#short-node" x="75" y="258" />
        <text x="175" y="273" class="text-math">c<tspan dy="-6" font-size="9px">Q</tspan><tspan dy="6" font-size="9px">t</tspan></text>
        
        <path d="M 120,258 L 120,230" class="line-norm" />
        <path d="M 70,230 L 170,230" class="line-norm" />
        
        <path d="M 70,230 L 70,200" class="line-blue" marker-end="url(#arrow-blue)" />
        <text x="35" y="215" class="text-math" fill="#00A2E8">W<tspan dy="-6" font-size="9px">UK</tspan><tspan dy="6" font-size="9px">q<tspan dy="-5">C</tspan><tspan dy="5">t,i</tspan></tspan></text>
        <use href="#stack-node" x="35" y="172" />
        <text x="30" y="185" class="text-math" text-anchor="end">{q<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>}</text>
        
        <path d="M 170,230 L 170,200" class="line-norm" marker-end="url(#arrow)" />
        <use href="#stack-node" x="135" y="172" />
        <text x="215" y="185" class="text-math" text-anchor="start">{q<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t,i</tspan>}</text>
        <text x="170" y="215" class="text-label">apply RoPE</text>
        
        <path d="M 70,172 L 70,140" class="line-norm" />
        <path d="M 170,172 L 170,140" class="line-norm" />
        <path d="M 70,140 L 170,140" class="line-norm" />
        <path d="M 120,140 L 120,120" class="line-norm" marker-end="url(#arrow)" />
        <text x="90" y="130" class="text-label">concatenate</text>
        
        <use href="#wide-stack-node" x="75" y="92" />
        <text x="65" y="105" class="text-math" text-anchor="end">{[q<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>; q<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t,i</tspan>]}</text>
        <path d="M 120,92 L 120,70" class="line-norm" marker-end="url(#arrow)" />
        
        <path d="M 290,295 L 290,280" class="line-norm" marker-end="url(#arrow)" />
        <use href="#short-node" x="245" y="258" />
        <text x="235" y="273" class="text-math" text-anchor="end">c<tspan dy="-6" font-size="9px">KV</tspan><tspan dy="6" font-size="9px">t</tspan></text>
        
        <path d="M 210,295 L 210,225" class="line-norm" marker-end="url(#arrow)" />
        <use href="#rope-node" x="199" y="203" />
        <text x="190" y="215" class="text-math" text-anchor="end">k<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t</tspan></text>
        <text x="170" y="240" class="text-label">apply RoPE</text>
        <path d="M 210,203 L 210,140" class="line-norm" />
        
        <path d="M 290,258 L 290,140" class="line-norm" />
        <path d="M 210,140 L 290,140" class="line-norm" />
        <path d="M 250,140 L 250,120" class="line-norm" marker-end="url(#arrow)" />
        <text x="280" y="130" class="text-label">concatenate</text>
        
        <use href="#short-node" x="215" y="92" />
        <text x="205" y="105" class="text-math" text-anchor="end">{[c<tspan dy="-6" font-size="9px">KV</tspan><tspan dy="6" font-size="9px">t</tspan>; k<tspan dy="-6" font-size="9px">R</tspan><tspan dy="6" font-size="9px">t</tspan>]}</text>
        <path d="M 250,92 L 250,70" class="line-norm" marker-end="url(#arrow)" />
        
        <path d="M 360,295 L 360,70" class="line-norm" marker-end="url(#arrow)" />
        
        <rect x="20" y="45" width="380" height="25" class="box-gray" />
        <text x="210" y="62" class="text-title" font-family="Arial" font-size="14px">Multi-Query Attention (Core Attention)</text>
        
        <path d="M 140,45 L 140,25" class="line-norm" marker-end="url(#arrow)" />
        <use href="#wide-stack-node" x="95" y="-3" />
        <text x="85" y="10" class="text-math" text-anchor="end">{o<tspan dy="-6" font-size="9px">C</tspan><tspan dy="6" font-size="9px">t,i</tspan>}</text>
        
        <path d="M 185,8 L 295,8" class="line-orange" marker-end="url(#arrow-orange)" />
        <text x="240" y="2" class="text-math" fill="#F26522">W<tspan dy="-6" font-size="9px">UV</tspan><tspan dy="6" font-size="9px">o<tspan dy="-5">C</tspan><tspan dy="5">t,i</tspan></tspan></text>
        
        <use href="#vshort-node" x="295" y="-3" />
        <text x="355" y="10" class="text-math" text-anchor="start">{o<tspan dy="6" font-size="9px">t,i</tspan>}</text>
        
        <path d="M 140,-3 L 140,-20" class="line-norm" marker-end="url(#arrow)" />
        <path d="M 320,-3 L 320,-20" class="line-norm" marker-end="url(#arrow)" />
        
        <use href="#hidden-node" x="140" y="-42" />
        <text x="135" y="-27" class="text-math" text-anchor="end">Output Hidden u<tspan dy="3" font-size="9px">t</tspan></text>
        
        <text x="210" y="375" class="text-title">(b) MQA mode of MLA.</text>
    </g>
'''

create_svg("public/images/architecture/fig4_arch_diagram.svg", arch_svg, 880, 440)
print("Arch SVG generated.")