def create_svg(filename, content, width, height):
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="100%" height="100%">
    <defs>
        <style>
            .ln {{ stroke: black; stroke-width: 1.5; fill: none; }}
            .ln-b {{ stroke: #00A2E8; stroke-width: 1.5; fill: none; }}
            .ln-o {{ stroke: #F26522; stroke-width: 1.5; fill: none; }}
            .tm {{ font-family: "Times New Roman",serif; font-size: 13px; font-style: italic; font-weight: bold; fill: black; }}
            .tl {{ font-family: Arial,sans-serif; font-size: 11px; font-style: italic; fill: #333; text-anchor: middle; }}
            .tt {{ font-family: "Times New Roman",serif; font-size: 15px; text-anchor: middle; fill: black; font-weight: bold; }}
            .bw {{ fill: white; stroke: black; stroke-width: 1.5; rx: 6; ry: 6; }}
            .bg {{ fill: #E6E7E8; stroke: black; stroke-width: 1.5; rx: 4; ry: 4; }}
            .ds {{ fill: white; stroke: black; stroke-width: 1.3; }}
        </style>
        <marker id="a" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3z" fill="black"/></marker>
        <marker id="ab" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3z" fill="#00A2E8"/></marker>
        <marker id="ao" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3z" fill="#F26522"/></marker>
    </defs>
    <rect width="100%" height="100%" fill="white"/>
    {content}
    </svg>'''
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(svg)

def pill(cx, cy, w, h, n_dots):
    """Draw a rounded pill with n_dots circles inside"""
    s = []
    rx, ry = cx - w/2, cy - h/2
    s.append(f'<rect x="{rx}" y="{ry}" width="{w}" height="{h}" class="bw"/>')
    if n_dots <= 3:
        gap = w / (n_dots + 1)
        for i in range(n_dots):
            s.append(f'<circle cx="{rx + gap*(i+1)}" cy="{cy}" r="5" class="ds"/>')
    else:
        # dots with ... in middle
        s.append(f'<circle cx="{rx+14}" cy="{cy}" r="5" class="ds"/>')
        s.append(f'<circle cx="{rx+30}" cy="{cy}" r="5" class="ds"/>')
        s.append(f'<text x="{cx}" y="{cy+4}" font-family="Arial" font-size="12" text-anchor="middle">. . .</text>')
        s.append(f'<circle cx="{rx+w-30}" cy="{cy}" r="5" class="ds"/>')
        s.append(f'<circle cx="{rx+w-14}" cy="{cy}" r="5" class="ds"/>')
    return "\n".join(s)

def stack(cx, cy, w, h, n_dots=2):
    """Draw 3-layer stacked pill"""
    s = []
    rx = cx - w/2
    ry = cy - h/2
    # Back layers
    s.append(f'<rect x="{rx+6}" y="{ry-4}" width="{w-4}" height="{h}" class="bw"/>')
    s.append(f'<rect x="{rx+3}" y="{ry-1}" width="{w-4}" height="{h}" class="bw"/>')
    # Front layer
    s.append(f'<rect x="{rx}" y="{ry+2}" width="{w-4}" height="{h}" class="bw"/>')
    fy = cy + 2
    if n_dots == 2:
        s.append(f'<circle cx="{rx+14}" cy="{fy}" r="5" class="ds"/>')
        s.append(f'<circle cx="{rx+w-18}" cy="{fy}" r="5" class="ds"/>')
    elif n_dots == 3:
        s.append(f'<circle cx="{rx+14}" cy="{fy}" r="5" class="ds"/>')
        s.append(f'<circle cx="{cx-2}" cy="{fy}" r="5" class="ds"/>')
        s.append(f'<circle cx="{rx+w-18}" cy="{fy}" r="5" class="ds"/>')
    return "\n".join(s)

def rope_box(cx, cy, s=20):
    """Small box with circle for RoPE"""
    r = []
    r.append(f'<rect x="{cx-s/2}" y="{cy-s/2}" width="{s}" height="{s}" class="bw" rx="3" ry="3"/>')
    r.append(f'<circle cx="{cx}" cy="{cy}" r="6" class="ds"/>')
    return "\n".join(r)

def arrow(x1, y1, x2, y2, color='black'):
    cls = 'ln'
    mk = 'a'
    if color == 'blue': cls, mk = 'ln-b', 'ab'
    elif color == 'orange': cls, mk = 'ln-o', 'ao'
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" class="{cls}" marker-end="url(#{mk})"/>'

def line(x1, y1, x2, y2, color='black'):
    cls = 'ln'
    if color == 'blue': cls = 'ln-b'
    elif color == 'orange': cls = 'ln-o'
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" class="{cls}"/>'

def txt(x, y, s, cls="tm", anchor="middle", fill="black"):
    return f'<text x="{x}" y="{y}" class="{cls}" text-anchor="{anchor}" fill="{fill}">{s}</text>'

def build():
    c = []
    
    PW = 450  # panel width
    GAP = 40
    
    # ====================== MHA (LEFT) ======================
    ox = 15
    
    # --- ROW 0: Output Hidden u_t (y=30) ---
    c.append(pill(ox+210, 30, 155, 22, 5))
    c.append(txt(ox+125, 35, 'Output Hidden u<tspan dy="3" font-size="9">t</tspan>', anchor="end"))
    
    # --- ROW 1: {o_t,i} (y=75) ---
    c.append(stack(ox+160, 75, 75, 22))
    c.append(txt(ox+115, 80, '{o<tspan dy="5" font-size="9">t,i</tspan>}', anchor="end"))
    
    # --- ROW 2: Core Attention bar (y=118) ---
    c.append(f'<rect x="{ox+15}" y="{108}" width="{PW-50}" height="{26}" class="bg"/>')
    c.append(txt(ox+210, 125, 'Multi-Head Attention (Core Attention)', cls="tt"))
    
    # --- ROW 3: Concatenated wide stacks (y=170) ---
    c.append(stack(ox+100, 170, 100, 22, 3))
    c.append(txt(ox+40, 165, '{[q<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>; q<tspan dy="-5" font-size="9">R</tspan><tspan dy="5" font-size="9">t,i</tspan>]}', anchor="end"))
    
    c.append(stack(ox+290, 170, 100, 22, 3))
    c.append(txt(ox+350, 165, '{[k<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>; k<tspan dy="-5" font-size="9">R</tspan><tspan dy="5" font-size="9">t</tspan>]}', anchor="start"))
    
    # concatenate labels
    c.append(txt(ox+100, 205, 'concatenate', cls="tl"))
    c.append(txt(ox+290, 205, 'concatenate', cls="tl"))
    
    # --- ROW 4: Individual stacks (y=250) ---
    c.append(stack(ox+55, 250, 70, 22))
    c.append(txt(ox+12, 245, '{q<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>}', anchor="end"))
    
    c.append(stack(ox+155, 250, 70, 22))
    
    c.append(pill(ox+230, 252, 35, 20, 2))
    c.append(txt(ox+255, 258, 'k<tspan dy="-5" font-size="9">R</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    c.append(stack(ox+310, 250, 70, 22))
    c.append(txt(ox+285, 245, '{k<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>}', anchor="end"))
    
    c.append(stack(ox+395, 250, 70, 22))
    c.append(txt(ox+420, 245, '{v<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>}', anchor="start"))
    
    # --- ROW 5: RoPE boxes (y=305) ---
    c.append(rope_box(ox+155, 305))
    c.append(rope_box(ox+230, 305))
    c.append(txt(ox+192, 325, 'apply RoPE', cls="tl"))
    
    # W^UK and W^UV labels (placed clearly to the side)
    c.append(txt(ox+275, 310, 'W<tspan dy="-5" font-size="9">UK</tspan><tspan dy="5">c</tspan><tspan dy="-4" font-size="8">KV</tspan><tspan dy="4" font-size="9">t</tspan>', fill="#00A2E8", anchor="start"))
    c.append(txt(ox+395, 310, 'W<tspan dy="-5" font-size="9">UV</tspan><tspan dy="5">c</tspan><tspan dy="-4" font-size="8">KV</tspan><tspan dy="4" font-size="9">t</tspan>', fill="#F26522", anchor="start"))
    
    # --- ROW 6: c^Q_t and c^KV_t (y=370) ---
    c.append(pill(ox+100, 370, 90, 22, 3))
    c.append(txt(ox+155, 375, 'c<tspan dy="-5" font-size="9">Q</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    c.append(pill(ox+330, 370, 90, 22, 3))
    c.append(txt(ox+385, 375, 'c<tspan dy="-5" font-size="9">KV</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    # --- ROW 7: Input Hidden h_t (y=440) ---
    c.append(pill(ox+210, 440, 155, 22, 5))
    c.append(txt(ox+125, 445, 'Input Hidden h<tspan dy="3" font-size="9">t</tspan>', anchor="end"))
    
    # ====== WIRING MHA ======
    # h_t → split
    c.append(arrow(ox+210, 429, ox+210, 415))
    c.append(line(ox+100, 415, ox+330, 415))
    c.append(arrow(ox+100, 415, ox+100, 381))
    c.append(arrow(ox+330, 415, ox+330, 381))
    
    # c^Q_t → split
    c.append(line(ox+100, 359, ox+100, 340))
    c.append(line(ox+55, 340, ox+155, 340))
    c.append(arrow(ox+55, 340, ox+55, 261))
    c.append(arrow(ox+155, 340, ox+155, 315))
    
    # c^KV_t → split + W arrows
    c.append(line(ox+330, 359, ox+330, 340))
    c.append(line(ox+310, 340, ox+395, 340))
    c.append(arrow(ox+310, 340, ox+310, 261, 'blue'))
    c.append(arrow(ox+395, 340, ox+395, 261, 'orange'))
    
    # h_t center → rope k^R_t
    c.append(arrow(ox+230, 415, ox+230, 315))
    
    # RoPE → stacks
    c.append(arrow(ox+155, 295, ox+155, 261))
    c.append(arrow(ox+230, 295, ox+230, 263))
    
    # stacks → concatenate → wide stacks
    c.append(line(ox+55, 239, ox+55, 215))
    c.append(line(ox+155, 239, ox+155, 215))
    c.append(line(ox+55, 215, ox+155, 215))
    c.append(arrow(ox+100, 215, ox+100, 181))
    
    c.append(line(ox+230, 241, ox+230, 215))
    c.append(line(ox+310, 239, ox+310, 215))
    c.append(line(ox+230, 215, ox+310, 215))
    c.append(arrow(ox+290, 215, ox+290, 181))
    
    # wide stacks + v → Core Attention
    c.append(arrow(ox+100, 159, ox+100, 134))
    c.append(arrow(ox+290, 159, ox+290, 134))
    c.append(arrow(ox+395, 239, ox+395, 134))
    
    # Core → o → u
    c.append(arrow(ox+210, 108, ox+160, 86))
    c.append(arrow(ox+160, 64, ox+160, 41))
    
    c.append(txt(ox+210, 490, '(a) MHA mode of MLA.', cls="tt"))
    
    # ====================== MQA (RIGHT) ======================
    ox2 = PW + GAP
    
    # --- ROW 0: Output Hidden u_t (y=30) ---
    c.append(pill(ox2+210, 30, 155, 22, 5))
    c.append(txt(ox2+125, 35, 'Output Hidden u<tspan dy="3" font-size="9">t</tspan>', anchor="end"))
    
    # --- ROW 1: {o^C_t,i} and {o_t,i} (y=75) ---
    c.append(stack(ox2+130, 75, 80, 22))
    c.append(txt(ox2+80, 80, '{o<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>}', anchor="end"))
    
    c.append(pill(ox2+355, 75, 50, 22, 2))
    c.append(txt(ox2+385, 80, '{o<tspan dy="5" font-size="9">t,i</tspan>}', anchor="start"))
    
    # Orange arrow + label
    c.append(arrow(ox2+175, 75, ox2+325, 75, 'orange'))
    c.append(txt(ox2+250, 66, 'W<tspan dy="-5" font-size="9">UV</tspan><tspan dy="5">o</tspan><tspan dy="-4" font-size="8">C</tspan><tspan dy="4" font-size="9">t,i</tspan>', fill="#F26522"))
    
    # --- ROW 2: Core Attention bar ---
    c.append(f'<rect x="{ox2+15}" y="{108}" width="{PW-50}" height="{26}" class="bg"/>')
    c.append(txt(ox2+210, 125, 'Multi-Query Attention (Core Attention)', cls="tt"))
    
    # --- ROW 3: Concatenated wide stacks ---
    c.append(stack(ox2+100, 170, 100, 22, 3))
    c.append(txt(ox2+40, 165, '{[q<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>; q<tspan dy="-5" font-size="9">R</tspan><tspan dy="5" font-size="9">t,i</tspan>]}', anchor="end"))
    
    c.append(stack(ox2+290, 170, 100, 22, 3))
    c.append(txt(ox2+350, 165, '{[c<tspan dy="-5" font-size="9">KV</tspan><tspan dy="5" font-size="9">t</tspan>; k<tspan dy="-5" font-size="9">R</tspan><tspan dy="5" font-size="9">t</tspan>]}', anchor="start"))
    
    c.append(txt(ox2+100, 205, 'concatenate', cls="tl"))
    c.append(txt(ox2+290, 205, 'concatenate', cls="tl"))
    
    # --- ROW 4: Individual stacks ---
    c.append(stack(ox2+55, 250, 70, 22))
    c.append(txt(ox2+12, 245, '{q<tspan dy="-5" font-size="9">C</tspan><tspan dy="5" font-size="9">t,i</tspan>}', anchor="end"))
    
    c.append(stack(ox2+155, 250, 70, 22))
    c.append(txt(ox2+200, 245, '{q<tspan dy="-5" font-size="9">R</tspan><tspan dy="5" font-size="9">t,i</tspan>}', anchor="start"))
    
    c.append(pill(ox2+230, 252, 35, 20, 2))
    c.append(txt(ox2+255, 258, 'k<tspan dy="-5" font-size="9">R</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    c.append(pill(ox2+310, 252, 55, 20, 2))
    c.append(txt(ox2+345, 258, 'c<tspan dy="-5" font-size="8">KV</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    c.append(pill(ox2+395, 252, 55, 20, 2))
    c.append(txt(ox2+430, 258, 'c<tspan dy="-5" font-size="8">KV</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    # --- ROW 5: RoPE boxes ---
    c.append(rope_box(ox2+155, 305))
    c.append(rope_box(ox2+230, 305))
    c.append(txt(ox2+192, 325, 'apply RoPE', cls="tl"))
    
    c.append(txt(ox2+40, 310, 'W<tspan dy="-5" font-size="9">UQ</tspan><tspan dy="5">c</tspan><tspan dy="-4" font-size="8">Q</tspan><tspan dy="4" font-size="9">t</tspan>', fill="#00A2E8", anchor="end"))
    
    # --- ROW 6: c^Q_t and c^KV_t ---
    c.append(pill(ox2+100, 370, 90, 22, 3))
    c.append(txt(ox2+155, 375, 'c<tspan dy="-5" font-size="9">Q</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    c.append(pill(ox2+330, 370, 90, 22, 3))
    c.append(txt(ox2+385, 375, 'c<tspan dy="-5" font-size="9">KV</tspan><tspan dy="5" font-size="9">t</tspan>', anchor="start"))
    
    # --- ROW 7: Input Hidden h_t ---
    c.append(pill(ox2+210, 440, 155, 22, 5))
    c.append(txt(ox2+125, 445, 'Input Hidden h<tspan dy="3" font-size="9">t</tspan>', anchor="end"))
    
    # ====== WIRING MQA ======
    c.append(arrow(ox2+210, 429, ox2+210, 415))
    c.append(line(ox2+100, 415, ox2+395, 415))
    c.append(arrow(ox2+100, 415, ox2+100, 381))
    c.append(arrow(ox2+330, 415, ox2+330, 381))
    
    # Far right bypass line (residual)
    c.append(arrow(ox2+395, 415, ox2+395, 263))
    
    # c^Q_t → split
    c.append(line(ox2+100, 359, ox2+100, 340))
    c.append(line(ox2+55, 340, ox2+155, 340))
    c.append(arrow(ox2+55, 340, ox2+55, 261, 'blue'))
    c.append(arrow(ox2+155, 340, ox2+155, 315))
    
    # c^KV_t → split
    c.append(line(ox2+330, 359, ox2+330, 340))
    c.append(line(ox2+310, 340, ox2+330, 340))
    c.append(arrow(ox2+310, 340, ox2+310, 263))
    
    # h_t center → rope k^R
    c.append(arrow(ox2+230, 415, ox2+230, 315))
    
    # RoPE → stacks
    c.append(arrow(ox2+155, 295, ox2+155, 261))
    c.append(arrow(ox2+230, 295, ox2+230, 263))
    
    # stacks → concatenate → wide stacks
    c.append(line(ox2+55, 239, ox2+55, 215))
    c.append(line(ox2+155, 239, ox2+155, 215))
    c.append(line(ox2+55, 215, ox2+155, 215))
    c.append(arrow(ox2+100, 215, ox2+100, 181))
    
    c.append(line(ox2+230, 241, ox2+230, 215))
    c.append(line(ox2+310, 241, ox2+310, 215))
    c.append(line(ox2+230, 215, ox2+310, 215))
    c.append(arrow(ox2+290, 215, ox2+290, 181))
    
    # wide stacks + bypass → Core Attention
    c.append(arrow(ox2+100, 159, ox2+100, 134))
    c.append(arrow(ox2+290, 159, ox2+290, 134))
    c.append(arrow(ox2+395, 241, ox2+395, 134))
    
    # Core → o^C → u_t  and  o → u_t
    c.append(arrow(ox2+160, 108, ox2+130, 86))
    c.append(arrow(ox2+130, 64, ox2+180, 41))
    c.append(arrow(ox2+355, 64, ox2+280, 41))
    
    c.append(txt(ox2+210, 490, '(b) MQA mode of MLA.', cls="tt"))
    
    return "\n".join(c)

create_svg("public/images/architecture/fig4_arch_diagram.svg", build(), 960, 510)
print("Done.")