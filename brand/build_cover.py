import math, sys
TAG = sys.argv[1] if len(sys.argv)>1 else 'Tap the hex. Ride the fuse.'
W,Hh=1500,500
def hx(cx,cy,r): return ' '.join(f"{cx+r*math.cos(math.pi/3*i):.1f},{cy+r*math.sin(math.pi/3*i):.1f}" for i in range(6))
def star(cx,cy,ro,ri,n=8,rot=-90):
    return ' '.join(f"{cx+(ro if i%2==0 else ri)*math.cos(math.radians(rot+180/n*i)):.1f},{cy+(ro if i%2==0 else ri)*math.sin(math.radians(rot+180/n*i)):.1f}" for i in range(2*n))
R=44; hh=math.sqrt(3)*R; cs=1.5*R
BOOM=(8,2)
ARMED=(11,4)   # (col,row) of the exploding hex
mults={}
import random; random.seed(7)
FUSE_PTS=None
def fuse_y(x):
    pts=FUSE_PTS
    if x<=pts[0][0]: return pts[0][1]
    for (x0,y0),(x1,y1) in zip(pts,pts[1:]):
        if x0<=x<=x1: return y0+(y1-y0)*(x-x0)/(x1-x0)
    return pts[-1][1]
def seg_dist(px,py):
    best=1e9
    for (x0,y0),(x1,y1) in zip(FUSE_PTS,FUSE_PTS[1:]):
        dx,dy=x1-x0,y1-y0; t=max(0,min(1,((px-x0)*dx+(py-y0)*dy)/(dx*dx+dy*dy)))
        best=min(best,math.hypot(px-(x0+t*dx),py-(y0+t*dy)))
    return best
def mult(i,j,x,y):
    # like the real board: cheap where the price is, growing fast with distance from it
    d=abs(y-fuse_y(x))/hh
    m=1.3*math.exp(0.9*d*d)*(1+0.04*random.random())
    return min(100,m)
bx=690+BOOM[0]*cs; by=40+BOOM[1]*hh+(BOOM[0]%2)*hh/2
FUSE_PTS=[(560,430),(600,418),(628,434),(664,400),(694,410),(730,368),(760,380),(800,330),(836,344),(872,300),(910,312),(948,268),(980,282),(bx-6,by+12),(bx+30,by-6),(bx+120,by-58),(bx+165,by-96)]
cells=[]
for i in range(0,14):
    x=690+i*cs
    for j in range(-1,6):
        y=40+j*hh+(i%2)*hh/2
        if y<-R or y>Hh+R: continue
        # watch-style shrink toward the right / top / bottom edges
        e=min(W-x, y+20, Hh-y+20)
        s=1 if e>130 else max(0.35,e/130)
        fade=1 if x>760 else max(0,(x-690)/70)
        cells.append((i,j,x,y,s*fade))
svg=[]
for (i,j,x,y,s) in cells:
    if s<=0.02: continue
    r=(R-3)*min(1,s)
    if (i,j)==BOOM: continue
    m=mult(i,j,x,y); hot=m>=10
    armed=(i,j)==ARMED
    if armed:
        svg.append(f'<polygon points="{hx(x,y,r)}" fill="#fbbf24" opacity="{min(1,s):.2f}"/>')
        if r>20: svg.append(f'<text x="{x:.1f}" y="{y-6:.1f}" class="t-armed-l" text-anchor="middle">ARMED</text><text x="{x:.1f}" y="{y+13:.1f}" class="t-armed" text-anchor="middle">$5</text>')
        continue
    fill='rgba(242,106,255,.08)' if hot else 'rgba(62,43,92,.30)'
    stroke='rgba(242,106,255,.32)' if hot else 'rgba(208,188,255,.20)'
    svg.append(f'<polygon points="{hx(x,y,r)}" fill="{fill}" stroke="{stroke}" stroke-width="1.2" opacity="{min(1,s+.15):.2f}"/>')
    if r>24 and seg_dist(x,y)>30:
        txt=('100' if m>=99.5 else f'{m:.1f}' if m>=10 else f'{m:.2f}')
        col='#fda9ff' if hot else ('rgba(208,188,255,.45)' if m<1.6 else '#d0bcff')
        svg.append(f'<text x="{x:.1f}" y="{y+6:.1f}" class="t-m" fill="{col}" text-anchor="middle" opacity="{min(1,s):.2f}">{txt}<tspan class="t-x">x</tspan></text>')
bx=690+BOOM[0]*cs; by=40+BOOM[1]*hh+(BOOM[0]%2)*hh/2
# exploded hex: emerald body, right side blown open (logo motif)
v=[(bx+R*math.cos(math.pi/3*k), by+R*math.sin(math.pi/3*k)) for k in range(6)]
open_path=f"M{v[5][0]:.1f} {v[5][1]:.1f} L{v[4][0]:.1f} {v[4][1]:.1f} L{v[3][0]:.1f} {v[3][1]:.1f} L{v[2][0]:.1f} {v[2][1]:.1f} L{v[1][0]:.1f} {v[1][1]:.1f}"
fuse=f"M560 430 L600 418 L628 434 L664 400 L694 410 L730 368 L760 380 L800 330 L836 344 L872 300 L910 312 L948 268 L980 282 L{bx-6:.0f} {by+12:.0f} L{bx+30:.0f} {by-6:.0f} L{bx+120:.0f} {by-58:.0f} L{bx+165:.0f} {by-96:.0f}"
sx,sy=bx+172,by-102
boom=f'''
<polygon points="{hx(bx,by,R+26)}" fill="none" stroke="#f26aff" stroke-width="3" opacity=".55"/>
<polygon points="{hx(bx,by,R+52)}" fill="none" stroke="#fbbf24" stroke-width="2" opacity=".28"/>
<polygon points="{hx(bx,by,R-3)}" fill="rgba(242,106,255,.28)"/>
<path d="{open_path}" fill="none" stroke="#fda9ff" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" filter="url(#glowG)"/>
<path d="{fuse}" fill="none" stroke="url(#fuseG)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" filter="url(#glowM)"/>
<polygon points="{star(sx,sy,26,8)}" fill="#fbbf24" filter="url(#glowA)"/>
<circle cx="{sx}" cy="{sy}" r="7" fill="#fff"/>
<g fill="#fbbf24"><rect x="{bx-60:.0f}" y="{by-50:.0f}" width="6" height="6"/><rect x="{bx+70:.0f}" y="{by+40:.0f}" width="5" height="5"/><rect x="{bx-30:.0f}" y="{by+70:.0f}" width="5" height="5"/><rect x="{sx-40:.0f}" y="{sy+30:.0f}" width="4" height="4"/></g>
<g fill="#f26aff"><rect x="{bx+52:.0f}" y="{by-70:.0f}" width="6" height="6"/><rect x="{bx-74:.0f}" y="{by+22:.0f}" width="5" height="5"/><rect x="{sx+24:.0f}" y="{sy+18:.0f}" width="4" height="4"/></g>
<text x="{bx:.0f}" y="{by+8:.0f}" class="t-boom" text-anchor="middle">BOOM</text>
<rect x="{bx-78:.0f}" y="{by+R+12:.0f}" width="168" height="42" rx="3" fill="#160234" fill-opacity=".92" stroke="rgba(251,191,36,.55)"/><text x="{bx+6:.0f}" y="{by+R+43:.0f}" class="t-win" text-anchor="middle">+$87.00</text>
'''
hexpat_R=22; ph=math.sqrt(3)*hexpat_R
pat=f"M0 {ph/2:.2f}L{hexpat_R/2:.0f} 0H{1.5*hexpat_R:.0f}L{2*hexpat_R:.0f} {ph/2:.2f}L{1.5*hexpat_R:.0f} {ph:.2f}H{hexpat_R/2:.0f}ZM{2*hexpat_R:.0f} {ph/2:.2f}H{3*hexpat_R:.0f}"
html=f'''<title>Hexit X Header</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@500;600&display=swap">
<style>
/* Layout: fixed 1500x500 X header. Lockup top-left (clear of the avatar's bottom-left overlap), honeycomb board + breakout on the right. */
:root{{color-scheme:dark;--bg:#1b0639;--lav:#d0bcff;--text:#ecdcff;--muted:#c1c7d3;--mag:#f26aff;--amber:#fbbf24;--emerald:#34d399;
  --f-head:"Space Grotesk","Arial Narrow",system-ui,sans-serif;--f-body:Inter,system-ui,sans-serif}}
html,body{{margin:0;background:#0d0220}}
body{{display:grid;place-items:start center;min-height:100%}}
.frame{{width:1500px;height:500px;position:relative;overflow:hidden;background:var(--bg);flex:none;transform-origin:top left}}
.frame>svg{{position:absolute;inset:0;width:100%;height:100%}}
.lock{{position:absolute;left:112px;top:118px;display:grid;gap:22px}}
.chip{{display:inline-flex;align-items:center;gap:10px;font-family:var(--f-head);font-weight:700;font-size:15px;letter-spacing:.24em;text-transform:uppercase;color:var(--muted);width:max-content}}
.chip i{{width:9px;height:9px;border-radius:50%;background:var(--emerald);box-shadow:0 0 12px var(--emerald)}}
.row{{display:flex;align-items:center;gap:26px}}
.row svg{{width:150px;height:150px;flex:none}}
.word{{font-family:var(--f-head);font-weight:700;font-style:italic;font-size:168px;line-height:.82;letter-spacing:-.035em;color:var(--text);text-transform:uppercase}}
.word b{{color:var(--mag);font-weight:700}}
.tag{{font-family:var(--f-head);font-weight:700;font-size:34px;letter-spacing:-.01em;color:var(--text);margin-top:4px}}
.tag span{{color:var(--amber)}}
.t-m{{font-family:var(--f-head);font-weight:700;font-size:17px}} .t-x{{font-size:12px}}
.t-armed{{font-family:var(--f-head);font-weight:700;font-size:20px;fill:#2b1a00}} .t-armed-l{{font-family:var(--f-head);font-weight:700;font-size:9px;letter-spacing:.12em;fill:#5b3b00}}
.t-boom{{font-family:var(--f-head);font-weight:700;font-style:italic;font-size:22px;fill:#ecdcff}}
.t-win{{font-family:var(--f-head);font-weight:700;font-size:30px;fill:#fbbf24}}
</style>
<div class="frame" id="frame">
<svg viewBox="0 0 1500 500" aria-hidden="true">
  <defs>
    <pattern id="hp" width="{3*hexpat_R}" height="{ph:.2f}" patternUnits="userSpaceOnUse"><path d="{pat}" fill="none" stroke="rgba(164,201,255,.055)" stroke-width="1"/></pattern>
    <radialGradient id="glow1" cx="72%" cy="40%" r="45%"><stop offset="0" stop-color="#571bc1" stop-opacity=".55"/><stop offset="1" stop-color="#1b0639" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow2" cx="18%" cy="45%" r="35%"><stop offset="0" stop-color="#3b1380" stop-opacity=".5"/><stop offset="1" stop-color="#1b0639" stop-opacity="0"/></radialGradient>
    <linearGradient id="fuseG" x1="560" x2="{bx:.0f}" y1="0" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f26aff" stop-opacity="0"/><stop offset=".35" stop-color="#f26aff" stop-opacity=".8"/><stop offset="1" stop-color="#f26aff"/></linearGradient>
    <filter id="glowM" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glowG" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <filter id="glowA" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="#1b0639"/><stop offset="1" stop-color="#1b0639" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1500" height="500" fill="url(#hp)"/>
  <rect width="1500" height="500" fill="url(#glow2)"/>
  <rect width="1500" height="500" fill="url(#glow1)"/>
  {''.join(svg)}
  {boom}
</svg>
<div class="lock">
  <div class="row">
    <span class="word">He<b>x</b>it</span>
  </div>
  <div class="tag">{TAG}</div>
</div>
</div>
<script>
// fit the fixed 1500x500 header into narrow viewers without changing the artwork
(function(){{ const f=document.getElementById('frame'); function fit(){{ const s=Math.min(1,(window.innerWidth-0)/1500); f.style.transform='scale('+s+')'; f.style.marginBottom=(500*s-500)+'px'; f.style.marginRight=(1500*s-1500)+'px'; }} fit(); addEventListener('resize',fit); }})();
</script>
'''
open('hexit-x-cover.html','w').write(html)
print('ok')
