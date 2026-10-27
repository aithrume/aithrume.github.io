"""경계 GeoJSON을 가볍게 만드는 스크립트 (Douglas-Peucker 단순화, 외부 라이브러리 없음).
사용: python tools/simplify_geo.py 입력.json 출력.json 허용오차(도) [최소면적]"""
import json, sys, math

def dp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False]*len(pts); keep[0]=keep[-1]=True
    stack=[(0,len(pts)-1)]
    while stack:
        a,b=stack.pop()
        ax,ay=pts[a]; bx,by=pts[b]
        dx,dy=bx-ax,by-ay; L=dx*dx+dy*dy
        mx,mi=-1,-1
        for i in range(a+1,b):
            px,py=pts[i]
            if L==0: d=math.hypot(px-ax,py-ay)
            else:
                t=max(0,min(1,((px-ax)*dx+(py-ay)*dy)/L))
                d=math.hypot(px-(ax+t*dx),py-(ay+t*dy))
            if d>mx: mx,mi=d,i
        if mx>eps:
            keep[mi]=True; stack+= [(a,mi),(mi,b)]
    return [p for p,k in zip(pts,keep) if k]

def area(r):
    return abs(sum(r[i][0]*r[i+1][1]-r[i+1][0]*r[i][1] for i in range(len(r)-1)))/2

def ring(r, eps, nd):
    s=dp(r,eps)
    if len(s)<4: return None
    return [[round(x,nd),round(y,nd)] for x,y in s]

src,dst,eps=sys.argv[1],sys.argv[2],float(sys.argv[3])
min_area=float(sys.argv[4]) if len(sys.argv)>4 else 0
g=json.load(open(src,encoding='utf-8'))
out=[]
for f in g['features']:
    geom=f['geometry']
    polys=geom['coordinates'] if geom['type']=='MultiPolygon' else [geom['coordinates']]
    newp=[]
    for poly in polys:
        if area(poly[0])<min_area: continue
        rs=[ring(r,eps,4) for r in poly]
        if rs[0] is None: continue
        newp.append([r for r in rs if r])
    if not newp:  # 너무 작은 섬뿐이면 가장 큰 조각은 남김
        big=max(polys,key=lambda p:area(p[0])); newp=[[ring(big[0],eps/4,4) or [[round(x,4),round(y,4)] for x,y in big[0]]]]  # 단순화하면 사라질 만큼 작으면 원래 모양
    p=f['properties']
    out.append({"type":"Feature","properties":{"code":p['code'],"name":p['name']},
      "geometry":{"type":"MultiPolygon","coordinates":newp}})
json.dump({"type":"FeatureCollection","features":out},open(dst,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
