"""
build_supply.py - 주택 공급·미분양 데이터(국토교통부, KOSIS)를 받아 supply.html 용 data/macro/supply.json 을 만드는 스크립트

■ 사용법 (저장소 최상위 폴더에서)
    python tools/build_supply.py

  - 미분양(시군구), 준공 후 미분양(시군구), 착공 실적(시도), 준공 실적(시도)을 2007년 1월부터 월별로 받습니다.
  - 매달 한 번(국토부 발표 후, 보통 말일 무렵) 실행해서 data/macro/supply.json 하나만 올리면 됩니다.
  - 광주·전남: 2026.7 통합(전남광주) 이후 자료가 하나로만 나와서, 앞뒤가 이어지도록 이전 달도 광주+전남을 합쳐 씁니다.
  - 지도 경계(2018년)에 맞추기: 시 아래 구는 시 하나로 합쳐 칠하고, 인천 개편 구·미추홀구·군위군은 아래 UNIT_FIX 로 맞춥니다.

■ 필요한 것: tools/api_keys.json 의 "KOSIS"(통계청 KOSIS 인증키)
"""
import os, sys, json, time, datetime, urllib.request, urllib.parse
from api_keys import get_key            # 같은 tools 폴더의 api_keys.py

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "macro", "supply.json")
GEO = os.path.join(ROOT, "data", "geo_sigungu.json")
API = "https://kosis.kr/openapi/Param/statisticsParameterData.do"
START = 2007

# 시도: (id, 화면 이름, 지도 경계 코드들, 자료의 이름들 - 합쳐서 씀)
SIDOS = [
    ("서울", "서울", ["11"], ["서울"]), ("부산", "부산", ["21"], ["부산"]), ("대구", "대구", ["22"], ["대구"]),
    ("인천", "인천", ["23"], ["인천"]), ("광주전남", "광주·전남", ["24", "36"], ["광주", "전남", "전남광주"]),
    ("대전", "대전", ["25"], ["대전"]), ("울산", "울산", ["26"], ["울산"]), ("세종", "세종", ["29"], ["세종"]),
    ("경기", "경기", ["31"], ["경기"]), ("강원", "강원", ["32"], ["강원"]), ("충북", "충북", ["33"], ["충북"]),
    ("충남", "충남", ["34"], ["충남"]), ("전북", "전북", ["35"], ["전북"]), ("경북", "경북", ["37"], ["경북"]),
    ("경남", "경남", ["38"], ["경남"]), ("제주", "제주", ["39"], ["제주"]),
]
METRO = ["서울", "인천", "경기"]
SRC2SIDO = {src: sid for sid, _, _, srcs in SIDOS for src in srcs}

# 자료의 시군구 이름 → 지도 단위 (2018년 경계에 없는 이름 맞추기). 값: (단위 id, 이름, [경계 이름들])
UNIT_FIX = {
    ("인천", "중구"): ("인천>옛중구동구", "옛 중구·동구", ["중구", "동구"]),
    ("인천", "동구"): ("인천>옛중구동구", "옛 중구·동구", ["중구", "동구"]),
    ("인천", "제물포구"): ("인천>옛중구동구", "옛 중구·동구", ["중구", "동구"]),
    ("인천", "영종구"): ("인천>옛중구동구", "옛 중구·동구", ["중구", "동구"]),
    ("인천", "서구"): ("인천>옛서구", "옛 서구", ["서구"]),
    ("인천", "서해구"): ("인천>옛서구", "옛 서구", ["서구"]),
    ("인천", "검단구"): ("인천>옛서구", "옛 서구", ["서구"]),
    ("인천", "미추홀구"): ("인천>미추홀구", "미추홀구", ["남구"]),
    ("인천", "남구"): ("인천>미추홀구", "미추홀구", ["남구"]),
}

# 옛 행정구역 이름 → 지금 이름 (통합·승격·개명 전 자료도 지금 시군구로 합쳐 추이가 이어지게)
NAME_ALIAS = {
    ("인천", "남구(미추홀구)"): "미추홀구", ("경기", "여주군"): "여주시", ("충북", "청원군"): "청주시",
    ("충남", "당진군"): "당진시", ("경남", "마산시"): "창원시", ("경남", "진해시"): "창원시",
}
SKIP_NAMES = {("세종", "조치원읍"), ("충남", "연기군")}      # 세종시 출범(2012) 전 지역 - 시도 합계에는 포함됨

# 통계표: (키, 표, 항목, objL 목록(ALL 은 지역 칸), 지역 칸 번호, 시군구 칸 번호 또는 None)
TABLES = {
    "unsold": ("DT_MLTM_2082", "13103871087T1", ["ALL", "ALL"], 1, 2),
    "after":  ("DT_MLTM_5328", "13103871088T1", ["ALL", "ALL", "13102871088C.0001", "13102871088D.0001"], 1, 2),
    "start":  ("DT_MLTM_5386", "13103766971T1", ["13102766971A.0001", "13102766971B.0001", "ALL"], 3, None),
    "done":   ("DT_MLTM_5373", "13103766973T1", ["ALL", "13102766973B.0002", "13102766973C.0002", "13102766973D.0002"], 1, None),
}
TOTAL_NAMES = ("계", "합계")


def fetch(key, table, item, objs, start, end):
    p = {"method": "getList", "apiKey": key, "orgId": "116", "tblId": table, "itmId": item, "format": "json",
         "jsonVD": "Y", "prdSe": "M", "startPrdDe": start, "endPrdDe": end}
    for i, o in enumerate(objs, 1):
        p[f"objL{i}"] = o
    for tries in range(4):                       # 서버가 가끔 연결을 끊어서 잠시 쉬었다 다시 시도
        try:
            with urllib.request.urlopen(API + "?" + urllib.parse.urlencode(p), timeout=120) as r:
                d = json.loads(r.read().decode("utf-8"))
            break
        except (OSError, ValueError) as e:
            if tries == 3:
                sys.exit(f"KOSIS 연결 실패 ({table} {start}~{end}): {e}")
            time.sleep(5 * (tries + 1))
    if isinstance(d, dict):                      # 오류 또는 자료 없음
        if str(d.get("err")) == "30":            # 30: 이 기간 자료 없음
            return []
        sys.exit(f"KOSIS 응답 오류 ({table} {start}~{end}): {d}")   # 31: 4만 칸 초과 등
    return d


def num(v):
    v = str(v).strip()
    return int(float(v)) if v not in ("", "-", "X") else None


def main():
    key, today = get_key("KOSIS"), datetime.date.today()
    feats = json.load(open(GEO, encoding="utf-8"))["features"]
    geo_by_sido = {}
    for f in feats:
        geo_by_sido.setdefault(f["properties"]["code"][:2], []).append((f["properties"]["code"], f["properties"]["name"]))
    sido_geo = {sid: geos for sid, _, geos, _ in SIDOS}

    def unit_of(src_sido, name):
        """자료의 (시도 이름, 시군구 이름) → (시도 id, 단위 id, 단위 이름, [경계 코드])"""
        sid = SRC2SIDO.get(src_sido)
        if not sid:
            return None
        fix = UNIT_FIX.get((src_sido if src_sido != "전남광주" else sid, name))
        uid, uname, names = fix if fix else (f"{sid}>{name}", name, [name])
        codes = []
        for want in names:
            for g in sido_geo[sid] + (["37"] if name == "군위군" else []):     # 군위군: 2018년 경계는 경북
                for code, gname in geo_by_sido.get(g, []):
                    if gname == want or (want.endswith("시") and gname.startswith(want) and gname.endswith("구")):
                        codes.append(code)
        return sid, uid, uname, sorted(set(codes))

    raw = {k: {} for k in TABLES}                # 키 → {(지역 id, 월): 값}
    units = {}
    months = set()
    for k, (table, item, objs, rcol, scol) in TABLES.items():
        rows = []
        for y in range(START, today.year + 1):   # 한 번에 4만 칸까지라 반년씩 (시도 19 × 시군구 220 × 6개월 ≈ 2.5만)
            for a, b in (("01", "06"), ("07", "12")):
                rows += fetch(key, table, item, objs, f"{y}{a}", f"{y}{b}")
        for r in rows:
            m, v = r["PRD_DE"], num(r["DT"])
            region, sub = r[f"C{rcol}_NM"].strip(), (r[f"C{scol}_NM"].strip() if scol else None)
            if v is None:
                continue
            if region in ("전국", "총계"):
                if sub is None or sub in TOTAL_NAMES:
                    raw[k][("전국", m)] = v
                    months.add(m)
                continue
            sid = SRC2SIDO.get(region)
            if not sid:
                continue                         # 수도권소계·기타지방 등은 직접 계산
            months.add(m)
            if sub is None or sub in TOTAL_NAMES:
                raw[k][(sid, m)] = raw[k].get((sid, m), 0) + v
            else:
                if (region, sub) in SKIP_NAMES:
                    continue
                sub = NAME_ALIAS.get((region, sub), sub)
                u = unit_of(region, sub)
                if not u:
                    continue
                _, uid, uname, codes = u
                units.setdefault(uid, {"id": uid, "name": uname, "sido": sid, "shapes": codes})
                raw[k][(uid, m)] = raw[k].get((uid, m), 0) + v
        print(f"  {k}: {len(rows):,}행")

    months = sorted(months)
    sids = [s[0] for s in SIDOS]
    for k in TABLES:                             # 전국 줄이 없는 표(미분양)는 시도 합계로
        for m in months:
            vals = [raw[k].get((s, m)) for s in sids if s != "세종"]      # 세종은 2012년부터라 없어도 합산
            if ("전국", m) not in raw[k] and all(v is not None for v in vals):
                raw[k][("전국", m)] = sum(vals) + (raw[k].get(("세종", m)) or 0)
    for k in TABLES:                             # 수도권·지방 합계
        for m in months:
            vals = [raw[k].get((s, m)) for s in METRO]
            if all(v is not None for v in vals):
                raw[k][("수도권", m)] = sum(vals)
                if ("전국", m) in raw[k]:
                    raw[k][("지방", m)] = raw[k][("전국", m)] - raw[k][("수도권", m)]

    def series(rid):
        return {k: [raw[k].get((rid, m)) for m in months] for k in TABLES if any((rid, m) in raw[k] for m in months)}

    # 한 경계를 두 단위가 차지하면(군위군: 경북 → 대구) 최근 자료가 있는 쪽에만 남김
    last = months[-1]
    owner = {}
    for u in units.values():
        for c in u["shapes"]:
            if c not in owner or raw["unsold"].get((u["id"], last)) is not None:
                owner[c] = u["id"]
    for u in units.values():
        u["shapes"] = [c for c in u["shapes"] if owner[c] == u["id"]]

    regions = [{"id": "전국", "name": "전국", "level": 0}, {"id": "수도권", "name": "수도권", "level": 0},
               {"id": "지방", "name": "지방", "level": 0}]
    regions += [{"id": sid, "name": name, "level": 1, "geo": geos} for sid, name, geos, _ in SIDOS]
    order = [s[0] for s in SIDOS]
    regions += sorted(({**u, "level": 2} for u in units.values()), key=lambda u: (order.index(u["sido"]), u["name"]))
    nomap = [r["id"] for r in regions if r["level"] == 2 and not r["shapes"]]
    if nomap:
        print("  [참고] 지도 경계를 찾지 못한 시군구:", ", ".join(nomap))
    out = {"updated": today.isoformat(), "months": months, "regions": regions,
           "data": {r["id"]: series(r["id"]) for r in regions}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n→ data/macro/supply.json ({os.path.getsize(OUT) // 1024} KB), {months[0]} ~ {months[-1]}, 시군구 {len(units)}곳")


if __name__ == "__main__":
    main()
