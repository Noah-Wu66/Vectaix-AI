import os

def create_svg(filename):
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1020 540" width="100%" height="100%">
  <defs>
    <style>
      .box { fill: #fff; stroke: #222; stroke-width: 1.5; rx: 6; ry: 6; }
      .box-stack-bg1 { fill: #fff; stroke: #222; stroke-width: 1.5; rx: 6; ry: 6; }
      .box-stack-bg2 { fill: #fff; stroke: #222; stroke-width: 1.5; rx: 6; ry: 6; }
      .core { fill: #f8f9fa; stroke: #222; stroke-width: 1.5; rx: 4; ry: 4; }
      .rope { fill: #fff; stroke: #222; stroke-width: 1.5; stroke-dasharray: 4,2; }
      .line { stroke: #222; stroke-width: 1.5; fill: none; }
      .line-blue { stroke: #0088cc; stroke-width: 1.5; fill: none; }
      .line-orange { stroke: #e65100; stroke-width: 1.5; fill: none; }
      .math { font-family: "Times New Roman", Times, serif; font-size: 15px; font-style: italic; font-weight: bold; fill: #111; }
      .label { font-family: Arial, sans-serif; font-size: 12px; font-style: italic; fill: #666; text-anchor: middle; }
      .title { font-family: "Times New Roman", Times, serif; font-size: 16px; fill: #111; text-anchor: middle; }
      .core-text { font-family: Arial, sans-serif; font-size: 14px; font-weight: bold; fill: #111; text-anchor: middle; }
    </style>
    
    <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#222" />
    </marker>
    <marker id="arrow-blue" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#0088cc" />
    </marker>
    <marker id="arrow-orange" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
      <path d="M0,0 L0,6 L6,3 z" fill="#e65100" />
    </marker>
  </defs>

  <rect width="100%" height="100%" fill="#ffffff" />
'''

    def get_text(name):
        if name == 'ht': return 'Input Hidden h<tspan dy="3" font-size="11">t</tspan>'
        if name == 'ut': return 'Output Hidden u<tspan dy="3" font-size="11">t</tspan>'
        if name == 'cQ': return 'c<tspan dy="3" font-size="11">t</tspan><tspan dy="-7" font-size="11">Q</tspan>'
        if name == 'cKV': return 'c<tspan dy="3" font-size="11">t</tspan><tspan dy="-7" font-size="11">KV</tspan>'
        
        if name == 'qC': return 'q<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">C</tspan>'
        if name == 'qR': return 'q<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">R</tspan>'
        if name == 'kC': return 'k<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">C</tspan>'
        if name == 'kR': return 'k<tspan dy="3" font-size="11">t</tspan><tspan dy="-7" font-size="11">R</tspan>'
        if name == 'vC': return 'v<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">C</tspan>'
        
        if name == 'concatQ': return '[ q<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">C</tspan><tspan dy="4" font-size="15"> ; </tspan>q<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">R</tspan><tspan dy="4" font-size="15"> ]</tspan>'
        if name == 'concatK_MHA': return '[ k<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">C</tspan><tspan dy="4" font-size="15"> ; </tspan>k<tspan dy="3" font-size="11">t</tspan><tspan dy="-7" font-size="11">R</tspan><tspan dy="4" font-size="15"> ]</tspan>'
        if name == 'concatK_MQA': return '[ c<tspan dy="3" font-size="11">t</tspan><tspan dy="-7" font-size="11">KV</tspan><tspan dy="4" font-size="15"> ; </tspan>k<tspan dy="3" font-size="11">t</tspan><tspan dy="-7" font-size="11">R</tspan><tspan dy="4" font-size="15"> ]</tspan>'
        
        if name == 'o': return 'o<tspan dy="3" font-size="11">t,i</tspan>'
        if name == 'oC': return 'o<tspan dy="3" font-size="11">t,i</tspan><tspan dy="-7" font-size="11">C</tspan>'
        
        if name == 'WUK': return 'W<tspan dy="-5" font-size="11">UK</tspan>'
        if name == 'WUV': return 'W<tspan dy="-5" font-size="11">UV</tspan>'
        if name == 'WUQ': return 'W<tspan dy="-5" font-size="11">UQ</tspan>'
        return name

    def make_box(x, y, w, h, text_id, style='normal'):
        rx = x - w/2
        ry = y - h/2
        c = []
        text_content = get_text(text_id)
        if style == 'stack':
            c.append(f'<rect x="{rx+6}" y="{ry-6}" width="{w}" height="{h}" class="box-stack-bg1" />')
            c.append(f'<rect x="{rx+3}" y="{ry-3}" width="{w}" height="{h}" class="box-stack-bg2" />')
            c.append(f'<rect x="{rx}" y="{ry}" width="{w}" height="{h}" class="box" />')
            c.append(f'<text x="{x}" y="{y+1}" class="math" text-anchor="middle" dominant-baseline="middle">{text_content}</text>')
        elif style == 'rope':
            c.append(f'<circle cx="{x}" cy="{y}" r="17" class="rope" />')
            c.append(f'<text x="{x}" y="{y+2}" class="math" font-size="12" font-style="normal" text-anchor="middle" dominant-baseline="middle">RoPE</text>')
        else:
            c.append(f'<rect x="{rx}" y="{ry}" width="{w}" height="{h}" class="box" />')
            if text_content:
                c.append(f'<text x="{x}" y="{y+1}" class="math" text-anchor="middle" dominant-baseline="middle">{text_content}</text>')
        return "\\n".join(c)

    def path(pts, color='black', marker=False):
        cls = 'line'
        if color == 'blue': cls = 'line-blue'
        if color == 'orange': cls = 'line-orange'
        m = ''
        if marker:
            if color == 'blue': m = 'marker-end="url(#arrow-blue)"'
            elif color == 'orange': m = 'marker-end="url(#arrow-orange)"'
            else: m = 'marker-end="url(#arrow)"'
        
        d = f"M {pts[0][0]},{pts[0][1]} "
        for p in pts[1:]:
            d += f"L {p[0]},{p[1]} "
        return f'<path d="{d}" class="{cls}" {m}/>'

    c = []
    
    # ================= MHA (LEFT) =================
    # Input
    c.append(make_box(250, 460, 200, 30, 'ht', 'normal'))
    
    # cQ, cKV
    c.append(make_box(140, 390, 80, 28, 'cQ', 'normal'))
    c.append(make_box(380, 390, 80, 28, 'cKV', 'normal'))
    
    # RoPE
    c.append(make_box(190, 320, 0, 0, '', 'rope'))
    c.append(make_box(290, 320, 0, 0, '', 'rope'))
    
    # q, k, v
    c.append(make_box(80, 260, 80, 28, 'qC', 'stack'))
    c.append(make_box(190, 260, 80, 28, 'qR', 'stack'))
    c.append(make_box(290, 260, 80, 28, 'kR', 'normal'))
    c.append(make_box(390, 260, 80, 28, 'kC', 'stack'))
    c.append(make_box(490, 260, 80, 28, 'vC', 'stack'))
    
    # Concat
    c.append(make_box(135, 160, 130, 28, 'concatQ', 'stack'))
    c.append(make_box(340, 160, 130, 28, 'concatK_MHA', 'stack'))
    
    # Core
    c.append('<rect x="40" y="80" width="480" height="40" class="core" />')
    c.append('<text x="280" y="105" class="core-text">Multi-Head Attention (Core Attention)</text>')
    
    # Output
    c.append(make_box(280, 40, 80, 28, 'o', 'stack'))
    c.append(make_box(280, -10, 220, 30, 'ut', 'normal'))
    
    # Lines
    c.append(path([(250,445), (250,420), (140,420), (140,404)], marker=True))
    c.append(path([(250,420), (380,420), (380,404)], marker=True))
    
    c.append(path([(140,376), (140,350), (80,350), (80,277)], marker=True))
    c.append(path([(140,350), (190,350), (190,337)], marker=True))
    c.append(path([(190,303), (190,277)], marker=True))
    
    c.append(path([(380,376), (380,350), (290,350), (290,337)], marker=True))
    c.append(path([(290,303), (290,273)], marker=True))
    
    c.append(path([(380,350), (390,350), (390,277)], color='blue', marker=True))
    c.append(f'<text x="382" y="325" class="math" fill="#0088cc" text-anchor="end">{get_text("WUK")}</text>')
    
    c.append(path([(380,350), (490,350), (490,277)], color='orange', marker=True))
    c.append(f'<text x="498" y="325" class="math" fill="#e65100" text-anchor="start">{get_text("WUV")}</text>')
    
    c.append(path([(80,247), (80,205), (190,205)]))
    c.append(path([(190,247), (190,205)]))
    c.append(path([(135,205), (135,174)], marker=True))
    c.append('<text x="135" y="197" class="label">concatenate</text>')
    
    c.append(path([(290,247), (290,205), (390,205)]))
    c.append(path([(390,247), (390,205)]))
    c.append(path([(340,205), (340,174)], marker=True))
    c.append('<text x="340" y="197" class="label">concatenate</text>')
    
    c.append(path([(135,147), (135,120)], marker=True))
    c.append(path([(340,147), (340,120)], marker=True))
    c.append(path([(490,247), (490,120)], marker=True))
    
    c.append(path([(280,80), (280,57)], marker=True))
    c.append(path([(280,27), (280,5)], marker=True))
    
    c.append('<text x="250" y="520" class="title">(a) MHA mode of MLA.</text>')

    # ================= MQA (RIGHT) =================
    # Input
    c.append(make_box(770, 460, 200, 30, 'ht', 'normal'))
    
    # cQ, cKV
    c.append(make_box(650, 390, 80, 28, 'cQ', 'normal'))
    c.append(make_box(890, 390, 80, 28, 'cKV', 'normal'))
    
    # RoPE
    c.append(make_box(700, 320, 0, 0, '', 'rope'))
    c.append(make_box(800, 320, 0, 0, '', 'rope'))
    
    # q, k, v
    c.append(make_box(590, 260, 80, 28, 'qC', 'stack'))
    c.append(make_box(700, 260, 80, 28, 'qR', 'stack'))
    c.append(make_box(800, 260, 80, 28, 'kR', 'normal'))
    c.append(make_box(890, 260, 80, 28, 'cKV', 'normal'))
    c.append(make_box(980, 260, 80, 28, 'cKV', 'normal'))
    
    # Concat
    c.append(make_box(645, 160, 130, 28, 'concatQ', 'stack'))
    c.append(make_box(845, 160, 130, 28, 'concatK_MQA', 'normal'))
    
    # Core
    c.append('<rect x="540" y="80" width="480" height="40" class="core" />')
    c.append('<text x="780" y="105" class="core-text">Multi-Query Attention (Core Attention)</text>')
    
    # Output
    c.append(make_box(645, 40, 80, 28, 'oC', 'stack'))
    c.append(make_box(820, 40, 80, 28, 'o', 'normal'))
    c.append(make_box(770, -10, 220, 30, 'ut', 'normal'))
    
    # Lines
    c.append(path([(770,445), (770,420), (650,420), (650,404)], marker=True))
    c.append(path([(770,420), (1030,420), (1030,-10), (870,-10)], marker=True))
    c.append(path([(770,420), (890,420), (890,404)], marker=True))
    
    c.append(path([(650,376), (650,350), (590,350), (590,277)], color='blue', marker=True))
    c.append(f'<text x="582" y="325" class="math" fill="#0088cc" text-anchor="end">{get_text("WUQ")}</text>')
    
    c.append(path([(650,350), (700,350), (700,337)], marker=True))
    c.append(path([(700,303), (700,277)], marker=True))
    
    c.append(path([(890,376), (890,350), (800,350), (800,337)], marker=True))
    c.append(path([(800,303), (800,273)], marker=True))
    
    c.append(path([(890,350), (890,274)], marker=True))
    c.append(path([(890,350), (980,350), (980,274)], marker=True))
    
    c.append(path([(590,247), (590,205), (700,205)]))
    c.append(path([(700,247), (700,205)]))
    c.append(path([(645,205), (645,174)], marker=True))
    c.append('<text x="645" y="197" class="label">concatenate</text>')
    
    c.append(path([(800,247), (800,205), (890,205)]))
    c.append(path([(890,247), (890,205)]))
    c.append(path([(845,205), (845,174)], marker=True))
    c.append('<text x="845" y="197" class="label">concatenate</text>')
    
    c.append(path([(645,147), (645,120)], marker=True))
    c.append(path([(845,147), (845,120)], marker=True))
    c.append(path([(980,247), (980,120)], marker=True))
    
    c.append(path([(645,80), (645,57)], marker=True))
    c.append(path([(690,40), (780,40)], color='orange', marker=True))
    c.append(f'<text x="735" y="30" class="math" fill="#e65100" text-anchor="middle">{get_text("WUV")}</text>')
    
    c.append(path([(820,27), (820,5)], marker=True))
    
    c.append('<text x="770" y="500" class="title">(b) MQA mode of MLA.</text>')
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write(svg + "\\n  <!-- Note: All nodes correctly boxed and aligned. -->\\n</svg>")

create_svg("public/images/architecture/fig4_arch_diagram.svg")
print("Arch SVG generated.")