# Contact sheet for tuning engine/mobius.js: same maths, rendered with Pillow.
# python3 tools/strip_preview.py out.png
import math, sys
from PIL import Image, ImageDraw
GOLD = [[92, 52, 24], [150, 92, 36], [214, 150, 58], [246, 204, 104], [255, 240, 186]]
TEAL = [[22, 60, 74], [30, 100, 112], [52, 156, 160], [112, 208, 198], [196, 246, 236]]
def render(time, size=112, W=0.45, tilt=-0.4, seg=96, vs=4, twist_top=True, speed=0.6, scale=3, edge=True):
    img = Image.new('RGBA', (size,size), (0,0,0,0)); d = ImageDraw.Draw(img)
    R = size*0.3
    spin = time*speed
    cs, sn = math.cos(spin), math.sin(spin); ct, st = math.cos(tilt), math.sin(tilt)
    # In-plane offset so the twist (u = pi) sits at the top (canvas -y) or bottom.
    off = (math.pi/2) if twist_top else (-math.pi/2)
    co, so = math.cos(off), math.sin(off)
    L = [-0.45,-0.55,0.7]
    def point(u,v):
        r = R*(1+W*v*math.cos(u/2)); x=r*math.cos(u); y=r*math.sin(u); z=R*W*v*math.sin(u/2)
        x,y = x*co-y*so, x*so+y*co           # place the twist
        x,z = x*cs+z*sn, -x*sn+z*cs          # spin about the vertical axis
        y,z = y*ct-z*st, y*st+z*ct           # look down a little
        return [x,y,z]
    quads=[]
    for i in range(seg):
        u0=i/seg*2*math.pi; u1=(i+1)/seg*2*math.pi
        for j in range(vs):
            v0=-1+2*j/vs; v1=-1+2*(j+1)/vs
            a,b,c,dd = point(u0,v0),point(u1,v0),point(u1,v1),point(u0,v1)
            e1=[c[k]-a[k] for k in range(3)]; e2=[dd[k]-b[k] for k in range(3)]
            n=[e1[1]*e2[2]-e1[2]*e2[1], e1[2]*e2[0]-e1[0]*e2[2], e1[0]*e2[1]-e1[1]*e2[0]]
            ln=math.hypot(*n) or 1
            facing=n[2]/ln
            lit=abs(sum(n[k]*L[k] for k in range(3))/ln)
            shade=max(0,min(1,0.22+0.78*lit))
            depth=(a[2]+b[2]+c[2]+dd[2])/4
            quads.append((depth,[a,b,c,dd],shade,facing,j==0,j==vs-1))
    quads.sort(key=lambda q:q[0])
    cx=cy=size/2
    P=lambda p:(round(cx+p[0]),round(cy+p[1]))
    for depth,pts,shade,facing,lo,hi in quads:
        level=min(4,int(shade*5))
        pal = GOLD if facing >= 0 else TEAL
        d.polygon([P(p) for p in pts], fill=tuple(pal[level])+(255,))
        if edge:
            ec=(255,247,214,255) if facing>=0 else (214,255,246,255)
            if lo: d.line([P(pts[0]),P(pts[1])], fill=ec)
            if hi: d.line([P(pts[2]),P(pts[3])], fill=ec)
    return img.resize((size*scale,size*scale), Image.NEAREST)
if __name__ == '__main__':
    variants=[dict(twist_top=True, tilt=-0.3), dict(twist_top=False, tilt=-0.3), dict(twist_top=True, tilt=-0.5, W=0.48), dict(twist_top=False, tilt=-0.15, W=0.48)]
    times=[0,1.0,2.0,3.0,4.0,5.0]
    sheet=Image.new('RGB',(len(times)*336,len(variants)*336),(40,36,52))
    for r,kw in enumerate(variants):
        for c,t in enumerate(times):
            im=render(t,**kw); sheet.paste(im,(c*336,r*336),im)
    sheet.save(sys.argv[1])
