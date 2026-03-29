import os

def create_svg(filename, content, width, height):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
    <defs>
        <style>
            .axis {{ stroke: black; stroke-width: 1.5; fill: none; }}
            .axis-bold {{ stroke: black; stroke-width: 2; fill: none; }}
            .line-blue {{ stroke: #00A2E8; stroke-width: 1.5; fill: none; }}
            .line-orange {{ stroke: #F26522; stroke-width: 1.5; fill: none; }}
            
            .text-math {{ font-family: "Times New Roman", Times, serif; font-size: 14px; font-style: italic; font-weight: bold; fill: black; }}
            .text-label {{ font-family: Arial, sans-serif; font-size: 11px; font-style: italic; fill: black; text-anchor: middle; }}
            .text-title {{ font-family: "Times New Roman", Times, serif; font-size: 16px; text-anchor: middle; fill: black; }}
            
            .box-white {{ fill: white; stroke: black; stroke-width: 1.5; rx: 6; ry: 6; }}
            .box-gray {{ fill: #E6E7E8; stroke: black; stroke-width: 1.5; rx: 4; ry: 4; }}
            .dot-small {{ fill: white; stroke: black; stroke-width: 1.5; }}
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
    </defs>
    
    <rect width="100%" height="100%" fill="white"/>
    
    {content}
    </svg>'''
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(svg)

def make_node(type, cx, cy, w=70, h=22):
    rx = cx - w/2
    ry = cy - h/2
    c = []
    
    if type == 'hidden':
        c.append(f'<rect x="{rx}" y="{ry}" width="{w}" height="{h}" class="box-white" />')
        # Dots
        c.append(f'<circle cx="{rx+15}" cy="{cy}" r="5" class="dot-small"/>')
        c.append(f'<circle cx="{rx+30}" cy="{cy}" r="5" class="dot-small"/>')
        c.append(f'<text x="{cx}" y="{cy+4}" font-family="Arial" font-size="14px" text-anchor="middle">. . .</text>')
        c.append(f'<circle cx="{rx+w-30}" cy="{cy}" r="5" class="dot-small"/>')
        c.append(f'<circle cx="{rx+w-15}" cy="{cy}" r="5" class="dot-small"/>')
        
    elif type == 'short':
        c.append(f'<rect x="{rx}" y="{ry}" width="{w}" height="{h}" class="box-white" />')
        c.append(f'<circle cx="{rx+15}" cy="{cy}" r="5" class="dot-small"/>')
        c.append(f'<text x="{cx}" y="{cy+4}" font-family="Arial" font-size="14px" text-anchor="middle">. . .</text>')
        c.append(f'<circle cx="{rx+w-15}" cy="{cy}" r="5" class="dot-small"/>')
        
    elif type == 'vshort':
        c.append(f'<rect x="{rx}" y="{ry}" width="{w}" height="{h}" class="box-white" />')
        c.append(f'<circle cx="{cx-10}" cy="{cy}" r="5" class="dot-small"/>')
        c.append(f'<circle cx="{cx+10}" cy="{cy}" r="5" class="dot-small"/>')
        
    elif type == 'rope':
        c.append(f'<rect x="{rx}" y="{ry}" width="{w}" height="{h}" class="box-white" rx="4" ry="4" />')
        c.append(f'<circle cx="{cx}" cy="{cy}" r="7" class="dot-small"/>')
        
    elif type == 'stack':
        # 3 layers
        c.append(f'<rect x="{rx+6}" y="{ry}" width="{w-6}" height="{h}" class="box-white" />')
        c.append(f'<rect x="{rx+3}" y="{ry+3}" width="{w-6}" height="{h}" class="box-white" />')
        c.append(f'<rect x="{rx}" y="{ry+6}" width="{w-6}" height="{h}" class="box-white" />')
        # Dots on front layer
        c.append(f'<circle cx="{rx+15}" cy="{cy+6}" r="5" class="dot-small"/>')
        c.append(f'<circle cx="{rx+w-21}" cy="{cy+6}" r="5" class="dot-small"/>')
        
    elif type == 'wstack':
        c.append(f'<rect x="{rx+6}" y="{ry}" width="{w-6}" height="{h}" class="box-white" />')
        c.append(f'<rect x="{rx+3}" y="{ry+3}" width="{w-6}" height="{h}" class="box-white" />')
        c.append(f'<rect x="{rx}" y="{ry+6}" width="{w-6}" height="{h}" class="box-white" />')
        c.append(f'<circle cx="{rx+15}" cy="{cy+6}" r="5" class="dot-small"/>')
        c.append(f'<circle cx="{cx-3}" cy="{cy+6}" r="5" class="dot-small"/>')
        c.append(f'<circle cx="{rx+w-21}" cy="{cy+6}" r="5" class="dot-small"/>')
        
    return "\n".join(c)

def line(x1, y1, x2, y2, marker=False, color='black'):
    cls = "axis"
    if color == 'blue': cls = "line-blue"
    elif color == 'orange': cls = "line-orange"
    
    m = ""
    if marker:
        if color == 'blue': m = 'marker-end="url(#arrow-blue)"'
        elif color == 'orange': m = 'marker-end="url(#arrow-orange)"'
        else: m = 'marker-end="url(#arrow)"'
        
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" class="{cls}" {m} />'

def text(x, y, s, cls="text-math", align="middle", fill="black"):
    return f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{align}" fill="{fill}">{s}</text>'

def build_architecture():
    c = []
    
    # ================= MHA (LEFT) =================
    c.append('<g transform="translate(10, 0)">')
    
    # Nodes
    c.append(make_node('hidden', 220, 430, w=160))
    c.append(text(130, 435, 'Input Hidden h<tspan dy="3" font-size="10px">t</tspan>', align="end"))
    
    c.append(make_node('short', 110, 360, w=90))
    c.append(text(55, 365, 'c<tspan dy="-6" font-size="10px">Q</tspan><tspan dy="6" font-size="10px">t</tspan>', align="end"))
    
    c.append(make_node('short', 330, 360, w=90))
    c.append(text(385, 365, 'c<tspan dy="-6" font-size="10px">KV</tspan><tspan dy="6" font-size="10px">t</tspan>', align="start"))
    
    c.append(make_node('rope', 160, 280, w=22))
    c.append(text(175, 285, 'apply RoPE', cls="text-label", align="start"))
    
    c.append(make_node('rope', 220, 280, w=22))
    c.append(text(205, 285, 'apply RoPE', cls="text-label", align="end"))
    
    c.append(make_node('stack', 60, 240, w=70))
    c.append(text(20, 245, '{q<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>}', align="end"))
    
    c.append(make_node('stack', 160, 240, w=70))
    c.append(text(200, 245, '{q<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t,i</tspan>}', align="start"))
    
    c.append(make_node('short', 220, 240, w=60))
    c.append(text(255, 245, 'k<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t</tspan>', align="start"))
    
    c.append(make_node('stack', 280, 240, w=70))
    c.append(text(240, 245, '{k<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>}', align="end"))
    
    c.append(make_node('stack', 380, 240, w=70))
    c.append(text(420, 245, '{v<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>}', align="start"))
    
    c.append(make_node('wstack', 110, 160, w=90))
    c.append(text(60, 165, '{[q<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>; q<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t,i</tspan>]}', align="end"))
    
    c.append(make_node('wstack', 250, 160, w=90))
    c.append(text(200, 165, '{[k<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>; k<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t</tspan>]}', align="end"))
    
    # Core Attention
    c.append('<rect x="20" y="95" width="400" height="25" class="box-gray" />')
    c.append(text(220, 112, 'Multi-Head Attention (Core Attention)', cls="text-title", align="middle"))
    
    c.append(make_node('stack', 220, 60, w=70))
    c.append(text(180, 65, '{o<tspan dy="6" font-size="10px">t,i</tspan>}', align="end"))
    
    c.append(make_node('hidden', 220, 20, w=160))
    c.append(text(130, 25, 'Output Hidden u<tspan dy="3" font-size="10px">t</tspan>', align="end"))
    
    # Paths MHA
    c.append(line(220, 419, 220, 400))
    c.append(line(110, 400, 330, 400))
    c.append(line(110, 400, 110, 371, marker=True))
    c.append(line(220, 400, 220, 291, marker=True))
    c.append(line(330, 400, 330, 371, marker=True))
    
    c.append(line(110, 349, 110, 320))
    c.append(line(60, 320, 160, 320))
    c.append(line(60, 320, 60, 251, marker=True))
    c.append(line(160, 320, 160, 291, marker=True))
    
    c.append(line(160, 269, 160, 251, marker=True))
    c.append(line(220, 269, 220, 251, marker=True))
    
    c.append(line(330, 349, 330, 320))
    c.append(line(280, 320, 380, 320))
    c.append(line(280, 320, 280, 251, marker=True, color='blue'))
    c.append(line(380, 320, 380, 251, marker=True, color='orange'))
    
    c.append(text(275, 295, 'W<tspan dy="-6" font-size="10px">UK</tspan><tspan dy="6" font-size="10px">c<tspan dy="-4">KV</tspan><tspan dy="4">t</tspan></tspan>', fill="#00A2E8", align="end"))
    c.append(text(385, 295, 'W<tspan dy="-6" font-size="10px">UV</tspan><tspan dy="6" font-size="10px">c<tspan dy="-4">KV</tspan><tspan dy="4">t</tspan></tspan>', fill="#F26522", align="start"))
    
    c.append(line(60, 229, 60, 200))
    c.append(line(160, 229, 160, 200))
    c.append(line(60, 200, 160, 200))
    c.append(line(110, 200, 110, 171, marker=True))
    c.append(text(110, 190, 'concatenate', cls="text-label"))
    
    c.append(line(220, 229, 220, 200))
    c.append(line(280, 229, 280, 200))
    c.append(line(220, 200, 280, 200))
    c.append(line(250, 200, 250, 171, marker=True))
    c.append(text(250, 190, 'concatenate', cls="text-label"))
    
    c.append(line(110, 149, 110, 120, marker=True))
    c.append(line(250, 149, 250, 120, marker=True))
    c.append(line(380, 229, 380, 120, marker=True))
    
    c.append(line(220, 95, 220, 71, marker=True))
    c.append(line(220, 49, 220, 31, marker=True))
    
    c.append(text(220, 480, '(a) MHA mode of MLA.', cls="text-title"))
    
    c.append('</g>')
    
    # ================= MQA (RIGHT) =================
    c.append('<g transform="translate(460, 0)">')
    
    # Nodes
    c.append(make_node('hidden', 220, 430, w=160))
    c.append(text(130, 435, 'Input Hidden h<tspan dy="3" font-size="10px">t</tspan>', align="end"))
    
    c.append(make_node('short', 110, 360, w=90))
    c.append(text(55, 365, 'c<tspan dy="-6" font-size="10px">Q</tspan><tspan dy="6" font-size="10px">t</tspan>', align="end"))
    
    c.append(make_node('short', 300, 360, w=90))
    c.append(text(245, 365, 'c<tspan dy="-6" font-size="10px">KV</tspan><tspan dy="6" font-size="10px">t</tspan>', align="end"))
    
    c.append(make_node('rope', 160, 280, w=22))
    c.append(text(175, 285, 'apply RoPE', cls="text-label", align="start"))
    
    c.append(make_node('rope', 220, 280, w=22))
    c.append(text(205, 285, 'apply RoPE', cls="text-label", align="end"))
    
    c.append(make_node('stack', 60, 240, w=70))
    c.append(text(20, 245, '{q<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>}', align="end"))
    
    c.append(make_node('stack', 160, 240, w=70))
    c.append(text(200, 245, '{q<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t,i</tspan>}', align="start"))
    
    c.append(make_node('short', 220, 240, w=60))
    c.append(text(255, 245, 'k<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t</tspan>', align="start"))
    
    c.append(make_node('short', 280, 240, w=50))
    c.append(text(270, 260, '{c<tspan dy="-6" font-size="10px">KV</tspan><tspan dy="6" font-size="10px">t</tspan>}', align="end"))
    
    c.append(make_node('short', 340, 240, w=50))
    c.append(text(350, 260, '{c<tspan dy="-6" font-size="10px">KV</tspan><tspan dy="6" font-size="10px">t</tspan>}', align="start"))
    
    c.append(make_node('wstack', 110, 160, w=90))
    c.append(text(60, 165, '{[q<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>; q<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t,i</tspan>]}', align="end"))
    
    c.append(make_node('wstack', 250, 160, w=90))
    c.append(text(200, 165, '{[c<tspan dy="-6" font-size="10px">KV</tspan><tspan dy="6" font-size="10px">t</tspan>; k<tspan dy="-6" font-size="10px">R</tspan><tspan dy="6" font-size="10px">t</tspan>]}', align="end"))
    
    # Core Attention
    c.append('<rect x="20" y="95" width="410" height="25" class="box-gray" />')
    c.append(text(225, 112, 'Multi-Query Attention (Core Attention)', cls="text-title", align="middle"))
    
    c.append(make_node('stack', 180, 60, w=80))
    c.append(text(135, 65, '{o<tspan dy="-6" font-size="10px">C</tspan><tspan dy="6" font-size="10px">t,i</tspan>}', align="end"))
    
    c.append(make_node('vshort', 360, 60, w=50))
    c.append(text(390, 65, '{o<tspan dy="6" font-size="10px">t,i</tspan>}', align="start"))
    
    c.append(make_node('hidden', 280, 20, w=220))
    c.append(text(160, 25, 'Output Hidden u<tspan dy="3" font-size="10px">t</tspan>', align="end"))
    
    # Paths MQA
    c.append(line(220, 419, 220, 400))
    c.append(line(110, 400, 410, 400))
    c.append(line(110, 400, 110, 371, marker=True))
    c.append(line(220, 400, 220, 291, marker=True))
    c.append(line(300, 400, 300, 371, marker=True))
    c.append(line(410, 400, 410, 31, marker=True)) # Far right line!
    
    c.append(line(110, 349, 110, 320))
    c.append(line(60, 320, 160, 320))
    c.append(line(60, 320, 60, 251, marker=True, color='blue'))
    c.append(line(160, 320, 160, 291, marker=True))
    
    c.append(text(55, 295, 'W<tspan dy="-6" font-size="10px">UQ</tspan><tspan dy="6" font-size="10px">c<tspan dy="-4">Q</tspan><tspan dy="4">t</tspan></tspan>', fill="#00A2E8", align="end"))
    
    c.append(line(160, 269, 160, 251, marker=True))
    c.append(line(220, 269, 220, 251, marker=True))
    
    c.append(line(300, 349, 300, 320))
    c.append(line(280, 320, 340, 320))
    c.append(line(280, 320, 280, 251, marker=True))
    c.append(line(340, 320, 340, 251, marker=True))
    
    c.append(line(60, 229, 60, 200))
    c.append(line(160, 229, 160, 200))
    c.append(line(60, 200, 160, 200))
    c.append(line(110, 200, 110, 171, marker=True))
    c.append(text(110, 190, 'concatenate', cls="text-label"))
    
    c.append(line(220, 229, 220, 200))
    c.append(line(280, 229, 280, 200))
    c.append(line(220, 200, 280, 200))
    c.append(line(250, 200, 250, 171, marker=True))
    c.append(text(250, 190, 'concatenate', cls="text-label"))
    
    c.append(line(110, 149, 110, 120, marker=True))
    c.append(line(250, 149, 250, 120, marker=True))
    c.append(line(340, 229, 340, 120, marker=True))
    
    c.append(line(180, 95, 180, 71, marker=True))
    c.append(line(225, 60, 330, 60, marker=True, color='orange'))
    c.append(text(280, 50, 'W<tspan dy="-6" font-size="10px">UV</tspan><tspan dy="6" font-size="10px">o<tspan dy="-4">C</tspan><tspan dy="4">t,i</tspan></tspan>', fill="#F26522", align="middle"))
    
    c.append(line(360, 49, 360, 31, marker=True))
    
    c.append(text(225, 480, '(b) MQA mode of MLA.', cls="text-title"))
    
    c.append('</g>')
    
    return "\n".join(c)

create_svg("public/images/architecture/fig4_arch_diagram.svg", build_architecture(), 900, 500)
print("Arch SVG generated.")