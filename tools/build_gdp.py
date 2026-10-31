"""
build_gdp.py - 한국은행 ECOS 에서 GDP 성장률(명목·실질, 연간·분기)을 받아 gdp.html 용 data/macro/gdp.json 을 만드는 스크립트

■ 사용법 (저장소 최상위 폴더에서)
    python tools/build_gdp.py

  - 분기 GDP 가 새로 발표되면(속보치: 분기 끝나고 약 4주 뒤, 잠정치: 약 9주 뒤) 다시 실행해서
    data/macro/gdp.json 하나만 올리면 됩니다. 과거 값도 수정되므로 매번 전체를 새로 받습니다.

■ 필요한 것: tools/api_keys.json 의 "BOK"(한국은행 ECOS 인증키)
"""
import os, sys, json, datetime, urllib.request, urllib.parse
from api_keys import get_key            # 같은 tools 폴더의 api_keys.py

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "macro", "gdp.json")
API = "https://ecos.bok.or.kr/api/StatisticSearch"

# (id, 이름, 통계표, 주기, 항목)
ANNUAL = [
    ("real",    "실질 GDP 성장률", "200Y101", "A", "20101"),
    ("nominal", "명목 GDP 성장률", "200Y101", "A", "50101"),
]
QUARTER = [
    ("realQoQ",    "실질, 전기 대비(계절조정)",    "200Y102", "Q", "10111"),
    ("nominalQoQ", "명목, 전기 대비(계절조정)",    "200Y102", "Q", "60111"),
    ("realYoY",    "실질, 전년 동기 대비(원계열)", "200Y102", "Q", "10211"),
    ("nominalYoY", "명목, 전년 동기 대비(원계열)", "200Y102", "Q", "60211"),
]


def fetch(key, table, cycle, item, start, end):
    url = "/".join([API, key, "json", "kr", "1", "10000", table, cycle, start, end, urllib.parse.quote(item)])
    with urllib.request.urlopen(url, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    if "StatisticSearch" not in d:
        sys.exit(f"ECOS 응답 오류 ({table}/{item}): {d.get('RESULT', {}).get('MESSAGE', d)}")
    return {row["TIME"]: float(row["DATA_VALUE"]) for row in d["StatisticSearch"]["row"] if row["DATA_VALUE"] not in ("", None)}


def build(key, spec, start, end):
    raw = {sid: fetch(key, table, cycle, item, start, end) for sid, _, table, cycle, item in spec}
    periods = sorted({p for v in raw.values() for p in v})
    for sid, name, *_ in spec:
        print(f"  {name}: {len(raw[sid])}개 ({min(raw[sid])} ~ {max(raw[sid])})")
    return {"periods": periods,
            "series": [{"id": sid, "name": name, "values": [raw[sid].get(p) for p in periods]} for sid, name, *_ in spec]}


def main():
    key, today = get_key("BOK"), datetime.date.today()
    out = {
        "updated": today.isoformat(),
        "annual": build(key, ANNUAL, "1971", str(today.year)),
        "quarter": build(key, QUARTER, "2000Q1", f"{today.year}Q4"),
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n→ data/macro/gdp.json ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
