"""
build_data.py - KB 주간 시계열 엑셀을 웹에서 쓰는 JSON으로 바꿔주는 스크립트

사용법 (새 주 데이터가 나올 때마다):
    python3 tools/build_data.py "다운받은_KB주간시계열.xlsx"

결과: data/kb/ 폴더에 index.json, map_sido.json, aggregate.json, sido_XX.json 이 만들어집니다.
(필요: pip install openpyxl)
"""
import sys, os, json, datetime
import openpyxl

SRC = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "kb")
os.makedirs(OUT, exist_ok=True)

# 엑셀 시트 이름 → 우리가 쓰는 키
SHEETS = {"si": "3.매매지수", "sc": "1.매매증감", "ji": "4.전세지수", "jc": "2.전세증감"}

# 시도 이름(엑셀 헤더) → (파일코드, 경계 GeoJSON 코드). 경계가 없으면 geo=None
SIDO = {
    "서울특별시": ("11", "11"), "부산광역시": ("21", "21"), "대구광역시": ("22", "22"),
    "인천광역시": ("23", "23"), "(구)광주광역시": ("24", "24"), "대전광역시": ("25", "25"),
    "울산광역시": ("26", "26"), "세종특별자치시": ("29", "29"), "경기도": ("31", "31"),
    "강원특별자치도": ("32", "32"), "충청북도": ("33", "33"), "충청남도": ("34", "34"),
    "전북특별자치도": ("35", "35"), "(구)전라남도": ("36", "36"), "경상북도": ("37", "37"),
    "경상남도": ("38", "38"), "제주특별자치도": ("39", "39"),
    "전남광주통합특별시": ("99", None),   # 2026.7 출범, 경계 없음(목록에서만 선택)
}
# 전국/권역 합산 지역 (지도에는 없고 그래프 비교용)
AGG = ["전국", "수도권", "6개광역시", "5개광역시", "기타지방", "강북14개구", "강남11개구"]
# 헤더 줄에 있지만 쓰지 않는 열
SKIP = {"제주도"}
# '시' 아래에 '구'가 붙는 지역(도 단위). 광역시는 구가 바로 시도 밑에 붙음
DO_SUFFIX = ("도",)  # 경기도, 충청북도, 강원특별자치도 ... 모두 '도'로 끝남


def num(v):
    return round(float(v), 3) if isinstance(v, (int, float)) else None


wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
tables = {}
headers = None
dates = None
for key, sheet in SHEETS.items():
    rows = list(wb[sheet].iter_rows(values_only=True))
    h = rows[1]
    data = [r for r in rows if isinstance(r[0], datetime.datetime)]
    d = [r[0].strftime("%Y-%m-%d") for r in data]
    names = [x for x in h[1:] if x]
    if headers is None:
        headers, dates = names, d
    else:  # 시트끼리 열/날짜가 같은지 확인 (지역 이름은 첫 시트 기준)
        assert len(names) == len(headers), f"{sheet}: 열 개수가 다릅니다"
        for i, (a, b) in enumerate(zip(headers, names)):
            if a != b:
                print(f"[경고] {sheet} {i+1}번째 열 이름이 다름: '{a}' vs '{b}' (앞의 것을 사용)")
        assert d == dates, f"{sheet}: 날짜가 다릅니다"
    tables[key] = data

# ---- 열 → 지역 계층 만들기 ----
regions = []          # {id,name,sido,level,parent,geo,col}
cur_sido = None
cur_si = None
for ci, name in enumerate(headers, start=1):
    if name in AGG:
        regions.append(dict(id=f"a{ci}", name=name, agg=True, col=ci))
        continue
    if name in SKIP:
        continue
    if name in SIDO:
        cur_sido, cur_si = name, None
        code, geo = SIDO[name]
        regions.append(dict(id=f"s{code}", name=name, sido=name, level=1, geo=geo, col=ci, file=code))
        continue
    if cur_sido is None:
        continue
    code = SIDO[cur_sido][0]
    use_si_logic = cur_sido.endswith(DO_SUFFIX) or cur_sido == "세종특별자치시"
    if use_si_logic and name.endswith("구") and cur_si:
        regions.append(dict(id=f"c{ci}", name=name, sido=cur_sido, level=3, parent=cur_si["id"],
                            si_name=cur_si["name"], col=ci, file=code))
    else:
        r = dict(id=f"c{ci}", name=name, sido=cur_sido, level=2, parent=f"s{code}", col=ci, file=code)
        regions.append(r)
        cur_si = r if name.endswith("시") else None

# ---- 시계열 만들기 ----
def series_of(col):
    s = {}
    for key, data in tables.items():
        arr = [num(r[col]) if col < len(r) else None for r in data]
        s[key] = arr
    return s

# 지수는 소수 2자리, 증감률은 소수 2자리로 용량을 줄임
def squeeze(s):
    return {k: [None if v is None else round(v, 2) for v in arr] for k, arr in s.items()}

files = {}
agg_out = {}
for r in regions:
    ser = squeeze(series_of(r["col"]))
    if r.get("agg"):
        agg_out[r["id"]] = ser
    else:
        files.setdefault(r["file"], {})[r["id"]] = ser

for code, ser in files.items():
    with open(os.path.join(OUT, f"sido_{code}.json"), "w", encoding="utf-8") as f:
        json.dump(ser, f, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(OUT, "aggregate.json"), "w", encoding="utf-8") as f:
    json.dump(agg_out, f, ensure_ascii=False, separators=(",", ":"))

# 시도 지도용: 모든 주의 시도별 증감률만 따로 (슬라이더가 가볍게 움직이도록)
map_sido = {}
for r in regions:
    if r.get("level") == 1:
        s = files[r["file"]][r["id"]]
        map_sido[r["id"]] = {"sc": s["sc"], "jc": s["jc"]}
with open(os.path.join(OUT, "map_sido.json"), "w", encoding="utf-8") as f:
    json.dump(map_sido, f, ensure_ascii=False, separators=(",", ":"))

# 목록/메타 정보
sidos = []
for r in regions:
    if r.get("level") == 1:
        kids = [{k: v for k, v in c.items() if k in ("id", "name", "level", "parent", "si_name")}
                for c in regions if c.get("sido") == r["name"] and c.get("level") in (2, 3)]
        sidos.append({"id": r["id"], "name": r["name"], "geo": r["geo"], "file": r["file"], "children": kids})
index = {
    "dates": dates,
    "latest": dates[-1],
    "base": "2026-01-12",  # 지수 기준일(=100) : 엑셀 제목 참고
    "sido": sidos,
    "agg": [{"id": r["id"], "name": r["name"]} for r in regions if r.get("agg")],
}
with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
    json.dump(index, f, ensure_ascii=False, separators=(",", ":"))

print("지역 수:", len(regions), "/ 주 수:", len(dates), "/ 마지막:", dates[-1])
for fn in sorted(os.listdir(OUT)):
    print(fn, os.path.getsize(os.path.join(OUT, fn)) // 1024, "KB")
