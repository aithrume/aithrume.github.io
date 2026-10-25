"""
build_trades.py - 국토교통부 실거래가(아파트 매매) 엑셀/CSV를 지도용 JSON으로 바꿔주는 스크립트

■ 새 달 데이터를 추가할 때 (저장소를 내려받은 폴더에서 실행)
    python3 tools/build_trades.py 새파일.xlsx
  - 파일 안의 '계약년월'을 보고 달마다 파일을 만듭니다.
        data/trades/m/202609.json   (그 달의 지역별 거래량·가격)
        data/trades/t/202609.json   (그 달의 지역별 최고가 거래 TOP3)
  - 기존 달의 파일은 건드리지 않습니다. 같은 달을 다시 넣으면 그 달 파일만 교체됩니다.
  - 마지막에 '올릴 파일' 목록을 알려줍니다. 그 파일들만 GitHub에 올리면 됩니다.

■ 처음 만들 때 (기존 data/trades 가 없을 때만)
    python3 tools/build_trades.py --init 파일들.xlsx

■ 목록 파일만 다시 만들고 싶을 때
    python3 tools/build_trades.py --rebuild

■ 옵션
    --asof 2026-10-25   데이터를 받은 날짜 (기본: 오늘). 신고 기한(30일)이 안 지난 달은 '집계중' 표시.

■ 필요한 것: pip install openpyxl   (CSV 파일만 쓰면 필요 없음)
"""
import sys, os, json, csv, calendar, datetime, statistics, heapq, argparse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "trades")
MDIR = os.path.join(OUT, "m")      # 월별 통계 파일
TDIR = os.path.join(OUT, "t")      # 월별 최고가 거래 파일
GEO = os.path.join(ROOT, "data", "geo_sigungu.json")

# 시도 이름 → 지도 경계(GeoJSON) 시도 코드
SIDO_GEO = {
    "서울특별시": "11", "부산광역시": "21", "대구광역시": "22", "인천광역시": "23",
    "광주광역시": "24", "대전광역시": "25", "울산광역시": "26", "세종특별자치시": "29",
    "경기도": "31", "강원특별자치도": "32", "충청북도": "33", "충청남도": "34",
    "전북특별자치도": "35", "전라남도": "36", "경상북도": "37", "경상남도": "38",
    "제주특별자치도": "39",
}
SIDO_ORDER = ["서울특별시", "경기도", "인천광역시", "부산광역시", "대구광역시", "광주광역시", "대전광역시",
              "울산광역시", "세종특별자치시", "강원특별자치도", "충청북도", "충청남도", "전북특별자치도",
              "전라남도", "경상북도", "경상남도", "제주특별자치도", "전남광주통합특별시"]
METRO = {"서울특별시", "인천광역시", "경기도"}          # 수도권
TONGHAP = "전남광주통합특별시"                           # 2026.7 출범 (광주+전남)
GWANGJU_GU = {"광산구", "남구", "동구", "북구", "서구"}   # 통합특별시 안에서 '옛 광주' 구역
TOP_N = 3

# 2018년 지도 경계에는 없는 신설 구를 '개편 전 구역'으로 묶어 지도에 칠하기 위한 설정
GROUPS = {
    "인천광역시/옛 중구·동구": {"members": ["제물포구", "영종구"], "shapes": ["중구", "동구"], "sido": "인천광역시"},
    "인천광역시/옛 서구": {"members": ["서해구", "검단구"], "shapes": ["서구"], "sido": "인천광역시"},
}
# KB 이름 → 2018년 경계 이름이 다른 지역
SHAPE_ALIAS = {"인천광역시/미추홀구": ["남구"]}


# ---------------------------------------------------------------- 읽기
def read_rows(path):
    """엑셀(.xlsx) 또는 CSV 에서 거래 한 줄씩 dict 로 꺼냄. 취소(해제) 거래는 제외."""
    def convert(header, values):
        d = dict(zip(header, values))
        if str(d.get("해제사유발생일", "-")).strip() not in ("-", "", "None"):
            return None                                   # 계약이 취소된 거래
        try:
            price = int(str(d["거래금액(만원)"]).replace(",", "").strip())
            area = float(str(d["전용면적(㎡)"]).strip())
            month = str(d["계약년월"]).strip()
        except (KeyError, ValueError):
            return None
        if area <= 0 or len(month) != 6:
            return None
        return {"loc": str(d["시군구"]), "price": price, "area": area, "month": month,
                "name": str(d.get("단지명", "")), "floor": str(d.get("층", "")), "day": str(d.get("계약일", ""))}

    period = None
    if path.lower().endswith(".csv"):
        with open(path, encoding="utf-8-sig", newline="") as f:
            rd = csv.reader(f)
            header = None
            for r in rd:
                if r and r[0] == "NO":
                    header = r
                    continue
                if header and r:
                    row = convert(header, r)
                    if row:
                        yield row
        return
    import openpyxl, warnings
    warnings.filterwarnings("ignore")
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.worksheets[0]
    ws.reset_dimensions()          # 이 파일들은 시트 크기 정보가 없어서 필요
    header = None
    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        if i == 9 and r and r[0] and "계약일자" in str(r[0]):
            period = str(r[0])
        if r and r[0] == "NO":
            header = list(r)
            continue
        if header and r and isinstance(r[0], (int, float)):
            row = convert(header, r)
            if row:
                yield row
    wb.close()


# ---------------------------------------------------------------- 지역 키
def region_keys(loc):
    """'경기도 수원시 영통구 영통동' → 이 거래가 포함될 지역 id 목록"""
    toks = loc.split()
    if not toks:
        return []
    sido = toks[0]
    rest = toks[1:]
    s2 = s3 = None
    if sido != "세종특별자치시" and rest:
        s2 = rest[0]
        if len(rest) >= 3 and s2.endswith("시") and rest[1].endswith("구"):
            s3 = rest[1]
    keys = ["전국"]
    if sido in METRO:
        keys.append("수도권")
    eff = sido
    if sido == TONGHAP:
        keys.append(TONGHAP)
        eff = "광주광역시" if s2 in GWANGJU_GU else "전라남도"
    keys.append(eff)
    if s2:
        keys.append(f"{eff}/{s2}")
        if s3:
            keys.append(f"{eff}/{s2}/{s3}")
        for gid, g in GROUPS.items():
            if eff == g["sido"] and s2 in g["members"]:
                keys.append(gid)
    return keys


def stats_of(rows):
    prices = [r[0] for r in rows]
    top = heapq.nlargest(TOP_N, rows, key=lambda r: r[0])
    return {
        "n": len(rows),
        "med": round(statistics.median(prices)),
        "avg": round(sum(prices) / len(prices)),
        "ppm": round(statistics.median(r[0] / r[1] for r in rows), 1),
        "mx": max(prices),
        "top": [[t[0], t[2], round(t[1], 1), t[3], t[4]] for t in top],
    }


def build_month_cache(rows):
    bucket = {}
    for r in rows:
        tup = (r["price"], r["area"], r["name"], r["floor"], r["day"])
        for k in region_keys(r["loc"]):
            bucket.setdefault(k, []).append(tup)
    return {k: stats_of(v) for k, v in sorted(bucket.items())}


# ---------------------------------------------------------------- 월별 파일 만들기
def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def ingest(files, asof):
    """파일들을 읽어 달마다 m/YYYYMM.json, t/YYYYMM.json 을 만든다. 새로 쓴 달 목록을 돌려줌."""
    by_month = {}        # month -> (rows, source)
    for p in files:
        print("읽는 중:", os.path.basename(p), flush=True)
        months = {}
        for row in read_rows(p):
            months.setdefault(row["month"], []).append(row)
        for m, rows in months.items():
            if m in by_month:
                print(f"  [경고] {m} 이(가) 두 파일에 있습니다. 나중 파일({os.path.basename(p)})을 사용합니다.")
            by_month[m] = (rows, os.path.basename(p))
    biggest = max((len(v[0]) for v in by_month.values()), default=0)
    written = []
    for m, (rows, src) in sorted(by_month.items()):
        if len(rows) < biggest * 0.05:
            print(f"  [참고] {m}: {len(rows)}건뿐입니다. 다른 달 파일에 끼어 있던 일부 거래일 수 있습니다 (그래도 그 달로 교체합니다).")
        keys = build_month_cache(rows)
        stats = {k: [v["n"], v["med"], v["avg"], v["ppm"], v["mx"]] for k, v in keys.items()}
        tops = {k: v["top"] for k, v in keys.items()}
        write_json(os.path.join(MDIR, f"{m}.json"),
                   {"month": m, "asof": asof.isoformat(), "rows": len(rows), "fields": ["n", "med", "avg", "ppm", "mx"], "keys": stats})
        write_json(os.path.join(TDIR, f"{m}.json"), tops)
        print(f"  {m}: {len(rows):,}건 → m/{m}.json, t/{m}.json")
        written.append(m)
    return written


# ---------------------------------------------------------------- 지도 경계 연결
def load_shapes():
    g = json.load(open(GEO, encoding="utf-8"))
    by_prefix, by_name = {}, {}
    for f in g["features"]:
        code, name = f["properties"]["code"], f["properties"]["name"]
        by_prefix.setdefault(code[:2], {})[name] = code
        by_name.setdefault(name, []).append(code)
    return by_prefix, by_name


def assign_shapes(regions):
    """각 지역이 지도에서 차지하는 경계 코드를 찾는다 (없으면 빈 목록)."""
    by_prefix, by_name = load_shapes()
    byid = {r["id"]: r for r in regions}
    used = {}

    def find(sido, name):
        pref = SIDO_GEO.get(sido)
        if pref and name in by_prefix.get(pref, {}):
            return by_prefix[pref][name]
        c = by_name.get(name, [])
        return c[0] if len(c) == 1 and sido in ("대구광역시",) and name == "군위군" else None

    # 1) 묶음(개편 전 구역) → 2) 구 → 3) 시·군
    for r in regions:
        r["shapes"] = []
    for gid, g in GROUPS.items():
        if gid in byid:
            byid[gid]["shapes"] = [by_prefix[SIDO_GEO[g["sido"]]][n] for n in g["shapes"]]
    for r in regions:
        if r["level"] == 3:
            sido = r["sido"]
            si = byid[r["parent"]]["name"]
            c = find(sido, si + r["name"])
            if c:
                r["shapes"] = [c]
    for r in regions:
        if r["level"] == 2 and not r.get("group") and not r["shapes"]:
            names = SHAPE_ALIAS.get(r["id"], [r["name"]])
            codes = [find(r["sido"], n) for n in names]
            codes = [c for c in codes if c]
            if codes:
                r["shapes"] = codes
    # 4) 구 경계만 있는 시(수원시 등) → 소속 구 경계 합침
    for r in regions:
        if r["level"] == 2 and not r.get("group") and not r["shapes"]:
            kids = [k for k in regions if k["parent"] == r["id"]]
            codes = [c for k in kids for c in k["shapes"]]
            if codes:
                r["shapes"] = codes
    return by_prefix


# ---------------------------------------------------------------- 목록 파일 (months.json, regions.json)
def read_json(path):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def region_of(key):
    parts = key.split("/")
    if key in ("전국", "수도권"):
        r = {"id": key, "name": key, "level": 0, "parent": None, "sido": None}
    elif key in GROUPS:
        r = {"id": key, "name": parts[1], "level": 2, "parent": parts[0], "sido": parts[0], "group": True,
             "members": [f"{parts[0]}/{x}" for x in GROUPS[key]["members"]]}
    elif len(parts) == 1:
        r = {"id": key, "name": key, "level": 1, "parent": None, "sido": key}
        if key == TONGHAP:
            r["total"] = True
        if key in ("광주광역시", "전라남도"):
            r["note"] = "전남광주통합특별시 출범(2026.7) 이전 구분"
    elif len(parts) == 2:
        r = {"id": key, "name": parts[1], "level": 2, "parent": parts[0], "sido": parts[0]}
    else:
        r = {"id": key, "name": parts[2], "level": 3, "parent": "/".join(parts[:2]), "sido": parts[0]}
    if r["level"] == 1 and r["id"] in SIDO_GEO:
        r["geo"] = SIDO_GEO[r["id"]]
    return r


def refresh_lists(new_months, init):
    """months.json(달 목록) 과 regions.json(지역 목록) 을 갱신한다. 기존 내용에 '더하기'만 한다."""
    old_months = read_json(os.path.join(OUT, "months.json"))
    old_regions = read_json(os.path.join(OUT, "regions.json"))
    local = sorted(f[:-5] for f in os.listdir(MDIR) if f.endswith(".json")) if os.path.isdir(MDIR) else []
    if old_months is None and not init and set(local) == set(new_months):
        sys.exit("이 폴더에는 기존 data/trades/months.json 이 없습니다.\n"
                 "· 이미 사이트에 데이터가 있다면: 저장소를 다시 내려받은 폴더(data/trades 가 있는 곳)에서 실행하세요.\n"
                 "· 처음 만드는 거라면: 명령에 --init 을 붙여 다시 실행하세요.")
    months = sorted(set((old_months or {}).get("months", [])) | set(local) | set(new_months))
    # 빠진 달 확인
    y, mo = int(months[0][:4]), int(months[0][4:])
    full = []
    while f"{y}{mo:02d}" <= months[-1]:
        full.append(f"{y}{mo:02d}")
        mo += 1
        if mo == 13:
            y, mo = y + 1, 1
    missing = [x for x in full if x not in months]
    if missing:
        print("[경고] 중간에 빠진 달:", ", ".join(missing), "(그래프에 빈 칸으로 나옵니다)")
    months = full
    notfound = [m for m in months if not os.path.exists(os.path.join(MDIR, f"{m}.json"))]
    if notfound:
        print("[참고] 이 컴퓨터에 파일이 없는 달:", ", ".join(notfound),
              "→ 이미 GitHub에 올라가 있다면 괜찮습니다. months.json 에는 그대로 포함합니다.")

    # 지역: 기존 목록 + 이번에 새로 나온 지역
    ids = {r["id"] for r in (old_regions or {}).get("regions", [])}
    for m in local:
        d = read_json(os.path.join(MDIR, f"{m}.json"))
        ids |= set(d["keys"].keys())
    regions = [region_of(k) for k in sorted(ids)]

    def order(r):
        s = r.get("sido") or r["id"]
        return (r["level"] > 0, SIDO_ORDER.index(s) if s in SIDO_ORDER else 99, r["id"])
    regions.sort(key=order)
    assign_shapes(regions)
    new_regions = {"minN": 5, "regions": regions}

    out = {}
    for name, obj in (("months.json", {"months": months}), ("regions.json", new_regions)):
        path = os.path.join(OUT, name)
        text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
        same = os.path.exists(path) and open(path, encoding="utf-8").read() == text
        if not same:
            write_json(path, obj)
        out[name] = not same
    nomap = [r["id"] for r in regions if r["level"] >= 2 and not r["shapes"]
             and not (r["level"] == 3 and any(p["id"] == r["parent"] and p["shapes"] for p in regions))]
    return months, out, nomap


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="실거래 데이터를 지도용 JSON으로 변환 (달마다 파일 1개씩)")
    ap.add_argument("files", nargs="*", help="새로 추가/교체할 xlsx 또는 csv 파일")
    ap.add_argument("--init", action="store_true", help="기존 data/trades 없이 처음 만들 때")
    ap.add_argument("--rebuild", action="store_true", help="파일 없이 목록(months/regions.json)만 다시 만들기")
    ap.add_argument("--asof", default=None, help="데이터를 받은 날짜 YYYY-MM-DD (기본: 오늘)")
    a = ap.parse_args()
    asof = datetime.date.fromisoformat(a.asof) if a.asof else datetime.date.today()
    if not a.files and not a.rebuild:
        ap.print_help()
        sys.exit(0)
    written = ingest(a.files, asof) if a.files else []
    months, changed, nomap = refresh_lists(written, a.init)
    print(f"\n전체 {len(months)}개월: {months[0]} ~ {months[-1]}")
    print("지도 경계가 없는 지역:", nomap or "없음")
    print("\n■ GitHub 의 data/trades 폴더에 올릴 파일")
    for m in written:
        print(f"   data/trades/m/{m}.json")
        print(f"   data/trades/t/{m}.json")
    print("   data/trades/months.json" + ("" if changed["months.json"] else "  (변경 없음 - 올리지 않아도 됨)"))
    print("   data/trades/regions.json" + ("" if changed["regions.json"] else "  (변경 없음 - 올리지 않아도 됨)"))
