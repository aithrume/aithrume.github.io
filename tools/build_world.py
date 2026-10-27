"""
build_world.py - Natural Earth 국가 경계를 여행 지도(travel.html)용 data/geo_world.json 으로 만드는 스크립트

■ 준비: Natural Earth 1:50m 국가 경계(GeoJSON)를 내려받습니다.
    https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson

■ 사용법
    python3 tools/build_world.py ne_50m_admin_0_countries.geojson

  - 나라 코드는 ADM0_A3 (예: KOR, JPN, FRA) 를 씁니다. data/travel.json 의 "country" 에 이 코드를 적습니다.
  - 이름은 Natural Earth 의 한국어 이름(NAME_KO)을 쓰고, 어색한 몇 개만 아래 NAME_FIX 로 고칩니다.
  - 모양은 simplify_geo.py 로 가볍게 줄입니다.
"""
import sys, os, json, subprocess, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "geo_world.json")
TOLERANCE = "0.06"      # 단순화 허용오차(도). 클수록 파일이 작고 모양이 거칠어짐
MIN_AREA = "0.002"     # 이보다 작은 섬은 버림 (도²)

NAME_FIX = {"KOR": "한국", "PRK": "북한", "TWN": "대만", "USA": "미국", "GBR": "영국", "CZE": "체코"}

src = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
g = json.load(open(src, encoding="utf-8"))
feats = []
for f in g["features"]:
    p = f["properties"]
    code = p["ADM0_A3"]
    feats.append({"type": "Feature", "properties": {"code": code, "name": NAME_FIX.get(code) or p.get("NAME_KO") or p["NAME"]},
                  "geometry": f["geometry"]})

# simplify_geo.py 는 code·name 만 있는 GeoJSON 을 받으므로 임시 파일로 넘김
with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as tmp:
    json.dump({"type": "FeatureCollection", "features": feats}, tmp, ensure_ascii=False)
try:
    subprocess.run([sys.executable, os.path.join(HERE, "simplify_geo.py"), tmp.name, OUT, TOLERANCE, MIN_AREA], check=True)
finally:
    os.remove(tmp.name)
print(f"나라 {len(feats)}개 → data/geo_world.json ({os.path.getsize(OUT) // 1024} KB)")
