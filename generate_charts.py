import math
import os

def create_svg(filename, content, width, height):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
    <defs>
        <style>
            .axis {{ stroke: black; stroke-width: 1; fill: none; }}
            .line-blue {{ stroke: #00A2E8; stroke-width: 1.5; fill: none; }}
            .line-orange {{ stroke: #F26522; stroke-width: 1.5; fill: none; }}
            .text-math {{ font-family: "Times New Roman", Times, serif; font-size: 11px; font-style: italic; font-weight: bold; }}
            .text-label {{ font-family: Arial, sans-serif; font-size: 10px; text-anchor: middle; }}
            .text-title {{ font-family: "Times New Roman", Times, serif; font-size: 13px; text-anchor: middle; }}
            
            .box-white {{ fill: white; stroke: black; stroke-width: 1; rx: 4; ry: 4; }}
            .box-gray {{ fill: #E6E7E8; stroke: black; stroke-width: 1; rx: 4; ry: 4; }}
            
            .stack-layer {{ fill: white; stroke: black; stroke-width: 0.8; }}
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

        <!-- Hidden State Node (Long pill) -->
        <g id="hidden-node">
            <rect x="0" y="0" width="120" height="18" class="box-white" />
            <circle cx="20" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
            <circle cx="40" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
            <text x="60" y="13" font-family="Arial" font-size="10px">. . .</text>
            <circle cx="80" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
            <circle cx="100" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
        </g>
        
        <!-- Short Node -->
        <g id="short-node">
            <rect x="0" y="0" width="70" height="18" class="box-white" />
            <circle cx="20" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
            <text x="45" y="13" font-family="Arial" font-size="10px">. . .</text>
            <circle cx="50" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
        </g>

        <!-- Very Short Node -->
        <g id="vshort-node">
            <rect x="0" y="0" width="50" height="18" class="box-white" />
            <circle cx="15" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
            <circle cx="35" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
        </g>

        <!-- RoPE Node (Circle in Box) -->
        <g id="rope-node">
            <rect x="0" y="0" width="18" height="18" class="box-white" />
            <circle cx="9" cy="9" r="6" fill="white" stroke="black" stroke-width="0.8"/>
        </g>

        <!-- Stacked Node (3 layers) -->
        <g id="stack-node">
            <rect x="4" y="0" width="60" height="16" class="box-white" />
            <rect x="2" y="2" width="60" height="16" class="box-white" />
            <rect x="0" y="4" width="60" height="16" class="box-white" />
            <circle cx="15" cy="12" r="5" fill="white" stroke="black" stroke-width="0.8"/>
            <circle cx="45" cy="12" r="5" fill="white" stroke="black" stroke-width="0.8"/>
        </g>
        
        <!-- Wide Stacked Node -->
        <g id="wide-stack-node">
            <rect x="4" y="0" width="80" height="16" class="box-white" />
            <rect x="2" y="2" width="80" height="16" class="box-white" />
            <rect x="0" y="4" width="80" height="16" class="box-white" />
            <circle cx="15" cy="12" r="5" fill="white" stroke="black" stroke-width="0.8"/>
            <circle cx="35" cy="12" r="5" fill="white" stroke="black" stroke-width="0.8"/>
            <circle cx="65" cy="12" r="5" fill="white" stroke="black" stroke-width="0.8"/>
        </g>
    </defs>
    
    <rect width="100%" height="100%" fill="white"/>
    
    {content}
    </svg>'''
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(svg)


def draw_architecture():
    c = []
    
    # =========================================================
    # LEFT PANEL: Multi-Head Attention (MHA) mode of MLA
    # =========================================================
    left_ox = 30
    left_oy = 20
    
    c.append(f'<g transform="translate({left_ox}, {left_oy})">')
    
    # Input Hidden h_t
    c.append('<use href="#hidden-node" x="140" y="280" />')
    c.append('<text x="135" y="293" class="text-math" text-anchor="end">Input Hidden h<tspan dy="3" font-size="8px">t</tspan></text>')
    
    # Main upward path from Input
    c.append('<path d="M 200,280 L 200,265" class="axis" marker-end="url(#arrow)"/>')
    
    # Horizontal split
    c.append('<path d="M 120,265 L 340,265" class="axis" />')
    
    # === Q Branch (Left) ===
    c.append('<path d="M 120,265 L 120,250" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#short-node" x="85" y="232" />')
    c.append('<text x="160" y="245" class="text-math">c<tspan dy="-5" font-size="8px">Q</tspan><tspan dy="5" font-size="8px">t</tspan></text>')
    
    # Split c_t^Q
    c.append('<path d="M 120,232 L 120,210" class="axis" />')
    c.append('<path d="M 80,210 L 160,210" class="axis" />')
    
    # q_t^C stack
    c.append('<path d="M 80,210 L 80,185" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#stack-node" x="50" y="165" />')
    c.append('<text x="45" y="175" class="text-math" text-anchor="end">{q<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    
    # q_t^R stack (RoPE)
    c.append('<path d="M 160,210 L 160,185" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#stack-node" x="130" y="165" />')
    c.append('<text x="195" y="175" class="text-math" text-anchor="start">{q<tspan dy="-5" font-size="8px">R</tspan><tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    c.append('<text x="160" y="195" class="text-label">apply RoPE</text>')
    
    # Concatenate Q
    c.append('<path d="M 80,165 L 80,145" class="axis" />')
    c.append('<path d="M 160,165 L 160,145" class="axis" />')
    c.append('<path d="M 80,145 L 160,145" class="axis" />')
    c.append('<path d="M 120,145 L 120,130" class="axis" marker-end="url(#arrow)" />')
    c.append('<text x="95" y="138" class="text-label" font-style="italic">concatenate</text>')
    
    c.append('<use href="#wide-stack-node" x="80" y="110" />')
    c.append('<text x="75" y="120" class="text-math" text-anchor="end">{[q<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>; q<tspan dy="-5" font-size="8px">R</tspan><tspan dy="5" font-size="8px">t,i</tspan>]}</text>')
    c.append('<path d="M 120,110 L 120,95" class="axis" marker-end="url(#arrow)" />')
    
    # === KV Branch (Right) ===
    c.append('<path d="M 280,265 L 280,250" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#short-node" x="245" y="232" />')
    c.append('<text x="235" y="245" class="text-math" text-anchor="end">c<tspan dy="-5" font-size="8px">KV</tspan><tspan dy="5" font-size="8px">t</tspan></text>')
    
    # k_t^R path (RoPE for KV)
    c.append('<path d="M 200,265 L 200,205" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#rope-node" x="191" y="187" />')
    c.append('<text x="185" y="195" class="text-math" text-anchor="end">k<tspan dy="-5" font-size="8px">R</tspan><tspan dy="5" font-size="8px">t</tspan></text>')
    c.append('<text x="165" y="215" class="text-label">apply RoPE</text>')
    c.append('<path d="M 200,187 L 200,145" class="axis" />')
    
    # Split c_t^KV
    c.append('<path d="M 280,232 L 280,210" class="axis" />')
    c.append('<path d="M 240,210 L 320,210" class="axis" />')
    
    # k_t^C stack (Blue arrow up)
    c.append('<path d="M 240,210 L 240,185" class="line-blue" marker-end="url(#arrow-blue)" />')
    c.append('<text x="210" y="200" class="text-math" fill="#00A2E8">W<tspan dy="-5" font-size="8px">UK</tspan><tspan dy="5" font-size="8px">c<tspan dy="-4">KV</tspan><tspan dy="4">t</tspan></tspan></text>')
    c.append('<use href="#stack-node" x="210" y="165" />')
    c.append('<text x="205" y="175" class="text-math" text-anchor="end">{k<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    
    # v_t^C stack (Orange arrow up)
    c.append('<path d="M 320,210 L 320,185" class="line-orange" marker-end="url(#arrow-orange)" />')
    c.append('<text x="290" y="200" class="text-math" fill="#F26522">W<tspan dy="-5" font-size="8px">UV</tspan><tspan dy="5" font-size="8px">c<tspan dy="-4">KV</tspan><tspan dy="4">t</tspan></tspan></text>')
    c.append('<use href="#stack-node" x="290" y="165" />')
    c.append('<text x="355" y="175" class="text-math" text-anchor="start">{v<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    
    # Concatenate K
    c.append('<path d="M 240,165 L 240,145" class="axis" />')
    c.append('<path d="M 200,145 L 240,145" class="axis" />')
    c.append('<path d="M 220,145 L 220,130" class="axis" marker-end="url(#arrow)" />')
    c.append('<text x="195" y="138" class="text-label" font-style="italic">concatenate</text>')
    
    c.append('<use href="#wide-stack-node" x="180" y="110" />')
    c.append('<text x="175" y="120" class="text-math" text-anchor="end">{[k<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>; k<tspan dy="-5" font-size="8px">R</tspan><tspan dy="5" font-size="8px">t</tspan>]}</text>')
    c.append('<path d="M 220,110 L 220,95" class="axis" marker-end="url(#arrow)" />')
    
    # V path to Core
    c.append('<path d="M 320,165 L 320,95" class="axis" marker-end="url(#arrow)" />')
    
    # === Core Attention Box ===
    c.append('<rect x="30" y="75" width="320" height="20" class="box-gray" />')
    c.append('<text x="190" y="89" class="text-title" font-family="Arial" font-size="12px">Multi-Head Attention (Core Attention)</text>')
    
    # Output
    c.append('<path d="M 190,75 L 190,55" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#stack-node" x="160" y="35" />')
    c.append('<text x="155" y="45" class="text-math" text-anchor="end">{o<tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    c.append('<path d="M 190,35 L 190,20" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#hidden-node" x="130" y="2" />')
    c.append('<text x="125" y="15" class="text-math" text-anchor="end">Output Hidden u<tspan dy="3" font-size="8px">t</tspan></text>')
    
    c.append('<text x="190" y="325" class="text-title">(a) MHA mode of MLA.</text>')
    
    c.append('</g>')
    
    # =========================================================
    # RIGHT PANEL: Multi-Query Attention (MQA) mode of MLA
    # =========================================================
    right_ox = 430
    right_oy = 20
    
    c.append(f'<g transform="translate({right_ox}, {right_oy})">')
    
    # Input Hidden h_t
    c.append('<use href="#hidden-node" x="140" y="280" />')
    c.append('<text x="135" y="293" class="text-math" text-anchor="end">Input Hidden h<tspan dy="3" font-size="8px">t</tspan></text>')
    
    # Main upward path
    c.append('<path d="M 200,280 L 200,265" class="axis" marker-end="url(#arrow)"/>')
    c.append('<path d="M 120,265 L 340,265" class="axis" />')
    
    # === Q Branch (Left) ===
    c.append('<path d="M 120,265 L 120,250" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#short-node" x="85" y="232" />')
    c.append('<text x="160" y="245" class="text-math">c<tspan dy="-5" font-size="8px">Q</tspan><tspan dy="5" font-size="8px">t</tspan></text>')
    
    # Split c_t^Q
    c.append('<path d="M 120,232 L 120,210" class="axis" />')
    c.append('<path d="M 80,210 L 160,210" class="axis" />')
    
    # q_t^C stack (Blue arrow up)
    c.append('<path d="M 80,210 L 80,185" class="line-blue" marker-end="url(#arrow-blue)" />')
    c.append('<text x="50" y="200" class="text-math" fill="#00A2E8">W<tspan dy="-5" font-size="8px">UK</tspan><tspan dy="5" font-size="8px">q<tspan dy="-4">C</tspan><tspan dy="4">t,i</tspan></tspan></text>')
    c.append('<use href="#stack-node" x="50" y="165" />')
    c.append('<text x="45" y="175" class="text-math" text-anchor="end">{q<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    
    # q_t^R stack (RoPE)
    c.append('<path d="M 160,210 L 160,185" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#stack-node" x="130" y="165" />')
    c.append('<text x="195" y="175" class="text-math" text-anchor="start">{q<tspan dy="-5" font-size="8px">A</tspan><tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    c.append('<text x="160" y="195" class="text-label">apply RoPE</text>')
    
    # Concatenate Q
    c.append('<path d="M 80,165 L 80,145" class="axis" />')
    c.append('<path d="M 160,165 L 160,145" class="axis" />')
    c.append('<path d="M 80,145 L 160,145" class="axis" />')
    c.append('<path d="M 120,145 L 120,130" class="axis" marker-end="url(#arrow)" />')
    c.append('<text x="95" y="138" class="text-label" font-style="italic">concatenate</text>')
    
    c.append('<use href="#wide-stack-node" x="80" y="110" />')
    c.append('<text x="75" y="120" class="text-math" text-anchor="end">{[q<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>; q<tspan dy="-5" font-size="8px">R</tspan><tspan dy="5" font-size="8px">t,i</tspan>]}</text>')
    c.append('<path d="M 120,110 L 120,95" class="axis" marker-end="url(#arrow)" />')
    
    # === KV Branch (Right) ===
    c.append('<path d="M 280,265 L 280,250" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#short-node" x="245" y="232" />')
    c.append('<text x="235" y="245" class="text-math" text-anchor="end">c<tspan dy="-5" font-size="8px">KV</tspan><tspan dy="5" font-size="8px">t</tspan></text>')
    
    # k_t^R path (RoPE)
    c.append('<path d="M 200,265 L 200,205" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#rope-node" x="191" y="187" />')
    c.append('<text x="185" y="195" class="text-math" text-anchor="end">k<tspan dy="-5" font-size="8px">R</tspan><tspan dy="5" font-size="8px">t</tspan></text>')
    c.append('<text x="165" y="215" class="text-label">apply RoPE</text>')
    c.append('<path d="M 200,187 L 200,145" class="axis" />')
    
    # Direct c_t^KV up
    c.append('<path d="M 280,232 L 280,145" class="axis" />')
    
    # Concatenate KV
    c.append('<path d="M 200,145 L 280,145" class="axis" />')
    c.append('<path d="M 240,145 L 240,130" class="axis" marker-end="url(#arrow)" />')
    c.append('<text x="270" y="138" class="text-label" font-style="italic">concatenate</text>')
    
    c.append('<use href="#short-node" x="205" y="110" />')
    c.append('<text x="200" y="120" class="text-math" text-anchor="end">{[c<tspan dy="-5" font-size="8px">KV</tspan><tspan dy="5" font-size="8px">t</tspan>; k<tspan dy="-5" font-size="8px">R</tspan><tspan dy="5" font-size="8px">t</tspan>]}</text>')
    c.append('<path d="M 240,110 L 240,95" class="axis" marker-end="url(#arrow)" />')
    
    # Direct pass to right of MQA
    c.append('<path d="M 340,265 L 340,95" class="axis" marker-end="url(#arrow)" />')
    
    # === Core Attention Box ===
    c.append('<rect x="30" y="75" width="320" height="20" class="box-gray" />')
    c.append('<text x="190" y="89" class="text-title" font-family="Arial" font-size="12px">Multi-Query Attention (Core Attention)</text>')
    
    # Output Side
    c.append('<path d="M 120,75 L 120,55" class="axis" marker-end="url(#arrow)" />')
    c.append('<use href="#wide-stack-node" x="80" y="35" />')
    c.append('<text x="75" y="45" class="text-math" text-anchor="end">{o<tspan dy="-5" font-size="8px">C</tspan><tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    
    # Output Orange Transformation
    c.append('<path d="M 160,43 L 260,43" class="line-orange" marker-end="url(#arrow-orange)" />')
    c.append('<text x="210" y="38" class="text-math" fill="#F26522">W<tspan dy="-5" font-size="8px">UV</tspan><tspan dy="5" font-size="8px">o<tspan dy="-4">C</tspan><tspan dy="4">t,i</tspan></tspan></text>')
    
    c.append('<use href="#vshort-node" x="260" y="35" />')
    c.append('<text x="315" y="45" class="text-math" text-anchor="start">{o<tspan dy="5" font-size="8px">t,i</tspan>}</text>')
    
    # Combine outputs to final hidden state
    c.append('<path d="M 120,35 L 120,20" class="axis" marker-end="url(#arrow)" />')
    c.append('<path d="M 285,35 L 285,20" class="axis" marker-end="url(#arrow)" />')
    
    c.append('<use href="#hidden-node" x="130" y="2" />')
    c.append('<text x="125" y="15" class="text-math" text-anchor="end">Output Hidden u<tspan dy="3" font-size="8px">t</tspan></text>')
    
    c.append('<text x="190" y="325" class="text-title">(b) MQA mode of MLA.</text>')
    
    c.append('</g>')
    
    return "\n".join(c)

c = draw_architecture()
create_svg("public/images/architecture/fig4_arch_diagram.svg", c, 840, 360)
print("Arch SVG generated.")