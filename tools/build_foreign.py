"""
build_foreign.py - 지역별 외국인 소유 공동주택 비율 데이터를 만드는 스크립트 (foreign.html 용)

■ 사용법 (저장소 최상위 폴더에서)
    python tools/build_foreign.py

  - 분자: 한국부동산원 R-ONE 「지역별 외국인주택소유현황_공동주택」(A_2024_00204), 반기별 시도·시군구
  - 분모: 통계청 KOSIS 「주택의 종류별 주택」(DT_1JU1501) 아파트+연립+다세대, 매년 11월 1일 기준
  - 반기마다 그 시점 기준 가장 최근 총조사를 분모로 씀: 상반기(6월 말) → 전년 총조사, 하반기(12월 말) → 같은 해 총조사
  - 결과: data/foreign/foreign.json  (반기가 새로 나오면 다시 실행해서 이 파일만 올리면 됩니다)

■ 필요한 것: tools/api_keys.json 의 "REB"(부동산원), "KOSIS"(통계청) 인증키
"""
import os, sys, json, datetime, urllib.request, urllib.parse
from api_keys import get_key            # 같은 tools 폴더의 api_keys.py

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "foreign", "foreign.json")
GEO = os.path.join(ROOT, "data", "geo_sigungu.json")

RONE_API = "http://www.reb.or.kr/r-one/openapi/SttsApiTblData.do"   # https 는 서버 인증서 문제로 http 사용
RONE_TABLE = "A_2024_00204"
KOSIS_API = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
KOSIS_TABLE = "DT_1JU1501"
KOSIS_ITEMS = ["T30", "T40", "T50"]      # 아파트, 연립주택, 다세대주택 = 공동주택

# 부동산원 시도 이름(짧은 이름) → (KOSIS 시도 이름, 지도 경계 코드)
SIDO = {
    "서울": ("서울특별시", "11"), "부산": ("부산광역시", "21"), "대구": ("대구광역시", "22"), "인천": ("인천광역시", "23"),
    "광주": ("광주광역시", "24"), "대전": ("대전광역시", "25"), "울산": ("울산광역시", "26"), "세종": ("세종특별자치시", "29"),
    "경기": ("경기도", "31"), "강원": ("강원특별자치도", "32"), "충북": ("충청북도", "33"), "충남": ("충청남도", "34"),
    "전북": ("전북특별자치도", "35"), "전남": ("전라남도", "36"), "경북": ("경상북도", "37"), "경남": ("경상남도", "38"),
    "제주": ("제주특별자치도", "39"),
}
SIDO_ORDER = list(SIDO)
SHAPE_ALIAS = {"인천>미추홀구": "남구"}   # 2018년 경계에는 옛 이름으로 남아 있는 구


def get_json(url, params):
    with urllib.request.urlopen(url + "?" + urllib.parse.urlencode(params), timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


# ---------------------------------------------------------------- 부동산원 (외국인 소유)
def fetch_rone():
    """{(반기, '서울>종로구'): {'h': 주택수, 'o': 소유자수}}, 반기 목록"""
    key, rows, page = get_key("REB"), [], 1
    while True:
        d = get_json(RONE_API, {"KEY": key, "Type": "json", "STATBL_ID": RONE_TABLE, "DTACYCLE_CD": "HY",
                                "pIndex": page, "pSize": 1000})
        body = d.get("SttsApiTblData")
        if not body:
            sys.exit("부동산원 API 응답을 읽지 못했습니다: " + json.dumps(d, ensure_ascii=False)[:300])
        part = body[1]["row"] if len(body) > 1 else []
        rows += part
        if len(rows) >= body[0]["head"][0]["list_total_count"] or not part:
            break
        page += 1
    vals, periods = {}, {}
    for r in rows:
        name = r["CLS_FULLNM"]
        if not name or r["ITM_NM"] not in ("주택수", "소유자수"):
            continue
        p = r["WRTTIME_IDTFR_ID"]
        periods[p] = r["WRTTIME_DESC"]
        vals.setdefault((p, name), {})["h" if r["ITM_NM"] == "주택수" else "o"] = r["DTA_VAL"]
    print(f"부동산원: {len(rows):,}행, 반기 {len(periods)}개 ({min(periods)} ~ {max(periods)})")
    return vals, dict(sorted(periods.items()))


# ---------------------------------------------------------------- KOSIS (전체 공동주택)
def census_year(period):
    """반기 '202501'(상반기) → '2024', '202502'(하반기) → '2025'"""
    y = int(period[:4])
    return str(y if period[4:] == "02" else y - 1)


def fetch_kosis(years):
    """{연도: {'전국' 또는 '서울>종로구' 꼴 경로: 공동주택 수}}"""
    key, full2short = get_key("KOSIS"), {v[0]: k for k, v in SIDO.items()}
    out = {}
    for y in years:
        d = get_json(KOSIS_API, {"method": "getList", "apiKey": key, "orgId": "101", "tblId": KOSIS_TABLE,
                                 "itmId": "+".join(KOSIS_ITEMS) + "+", "objL1": "ALL", "format": "json", "jsonVD": "Y",
                                 "prdSe": "Y", "startPrdDe": y, "endPrdDe": y})
        if isinstance(d, dict):
            print(f"  [참고] KOSIS {y}년 자료 없음: {d.get('errMsg', d)}")
            continue
        rows = [r for r in d if len(r["C1"]) in (2, 5)]       # 시도(2자리)·시군구(5자리)만
        names = {r["C1"]: r["C1_NM"] for r in rows}
        total, hidden = {}, set()
        for r in rows:
            v = str(r["DT"]).strip()
            if v in ("", "-", "0"):
                v = "0"
            if not v.isdigit():                                # 'X' = 통계청 비공개(소수 보호) → 그 지역은 빈칸
                hidden.add(r["C1"])
                continue
            total[r["C1"]] = total.get(r["C1"], 0) + int(v)
        for c in hidden:
            total.pop(c, None)
        paths = {"00": "전국"}
        for c, n in names.items():
            if len(c) == 2 and n in full2short:
                paths[c] = full2short[n]
        for c, n in names.items():
            if len(c) != 5 or c[:2] not in paths:
                continue
            sido = paths[c[:2]]
            parent = c[:4] + "0"                               # 31011 장안구 → 31010 수원시
            if c[4] != "0" and parent in names and names[parent].endswith("시"):
                paths[c] = f"{sido}>{names[parent]}>{n}"
            else:
                paths[c] = f"{sido}>{n}"
        out[y] = {paths[c]: v for c, v in total.items() if c in paths}
        print(f"KOSIS {y}년: 지역 {len(out[y])}곳, 전국 공동주택 {out[y].get('전국', 0):,}호")
    return out


# ---------------------------------------------------------------- 지도 경계 연결
def assign_shapes(regions, latest_has):
    """각 지역이 지도에서 차지하는 경계 코드(2018년 통계청 경계)."""
    feats = json.load(open(GEO, encoding="utf-8"))["features"]
    by_sido = {}
    for f in feats:
        by_sido.setdefault(f["properties"]["code"][:2], {})[f["properties"]["name"]] = f["properties"]["code"]
    by_name = {}
    for f in feats:
        by_name.setdefault(f["properties"]["name"], []).append(f["properties"]["code"])

    def find(sido, name):
        hit = by_sido.get(SIDO[sido][1], {}).get(name)
        if hit:
            return hit
        c = by_name.get(name, [])
        return c[0] if len(c) == 1 else None                  # 군위군처럼 소속 시도가 바뀐 곳

    byid = {r["id"]: r for r in regions}
    for r in regions:
        r["shapes"] = []
        if r["level"] == 3:                                   # 경기>수원시>장안구 → '수원시장안구'
            c = find(r["sido"], byid[r["parent"]]["name"] + r["name"])
            r["shapes"] = [c] if c else []
    for r in regions:
        if r["level"] == 2:
            c = find(r["sido"], SHAPE_ALIAS.get(r["id"], r["name"]))
            if c:
                r["shapes"] = [c]
            else:                                             # 구 경계만 있는 시 → 소속 구 경계를 합침
                r["shapes"] = [s for k in regions if k.get("parent") == r["id"] for s in k["shapes"]]
    # 한 경계를 두 지역이 차지하면(군위군: 경북→대구) 최근 자료가 있는 쪽만 남김
    owner = {}
    for r in regions:
        if r["level"] == 2:
            for c in r["shapes"]:
                if c in owner and not latest_has(r["id"]):
                    continue
                owner[c] = r["id"]
    for r in regions:
        if r["level"] == 2:
            r["shapes"] = [c for c in r["shapes"] if owner.get(c) == r["id"]]
    return [r["id"] for r in regions if r["level"] >= 2 and not r["shapes"]]


# ---------------------------------------------------------------- 실행
def main():
    vals, periods = fetch_rone()
    plist = list(periods)
    years = sorted({census_year(p) for p in plist})
    kosis = fetch_kosis(years)

    names = sorted({n for (_, n) in vals}, key=lambda n: (SIDO_ORDER.index(n.split(">")[0]), n))
    regions = [{"id": "전국", "name": "전국", "level": 0}]
    for n in names:
        parts = n.split(">")
        r = {"id": n, "name": parts[-1], "level": len(parts), "sido": parts[0]}
        if len(parts) == 1:
            r["name"], r["geo"] = SIDO[n][0], SIDO[n][1]
        else:
            r["parent"] = ">".join(parts[:-1])
        regions.append(r)

    data = {}
    for r in regions:
        rid, h, o, t = r["id"], [], [], []
        for p in plist:
            if rid == "전국":
                sidos = [vals.get((p, s), {}) for s in SIDO]
                hv = sum(x.get("h") or 0 for x in sidos)
                ov = sum(x.get("o") or 0 for x in sidos)
            else:
                hv, ov = vals.get((p, rid), {}).get("h"), vals.get((p, rid), {}).get("o")
            h.append(hv)
            o.append(ov)
            t.append(kosis.get(census_year(p), {}).get(rid))
        data[rid] = {"h": h, "o": o, "t": t}

    unmatched = sorted({rid for rid, d in data.items() if any(hv is not None and tv is None for hv, tv in zip(d["h"], d["t"]))})
    if unmatched:
        print("[참고] KOSIS 공동주택 수를 찾지 못한 지역(그 시점 비율은 빈칸):", ", ".join(unmatched))

    last = len(plist) - 1
    nomap = assign_shapes(regions, lambda rid: data[rid]["h"][last] is not None)
    if nomap:
        print("[참고] 지도 경계가 없는 지역(목록에서만 선택):", ", ".join(nomap))

    out = {
        "updated": datetime.date.today().isoformat(),
        "periods": [{"id": p, "label": periods[p], "census": census_year(p)} for p in plist],
        "regions": regions,
        "data": data,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n→ data/foreign/foreign.json ({os.path.getsize(OUT) // 1024} KB), 지역 {len(regions)}곳, 반기 {len(plist)}개")


if __name__ == "__main__":
    main()
