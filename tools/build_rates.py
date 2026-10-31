"""
build_rates.py - 한국은행 ECOS 에서 주요 금리(월별)를 받아 rates.html 용 data/macro/rates.json 을 만드는 스크립트

■ 사용법 (저장소 최상위 폴더에서)
    python tools/build_rates.py

  - 매달 한 번 실행해서 data/macro/rates.json 하나만 올리면 됩니다. (매번 전체 기간을 새로 받음)
  - 받을 금리는 아래 SERIES 에서 고칩니다. 통계표 코드·항목 코드는 ECOS 개발 명세서나
    StatisticItemList API 로 확인할 수 있습니다.

■ 필요한 것: tools/api_keys.json 의 "BOK"(한국은행 ECOS 인증키)
"""
import os, sys, json, datetime, urllib.request, urllib.parse
from api_keys import get_key            # 같은 tools 폴더의 api_keys.py

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "macro", "rates.json")
API = "https://ecos.bok.or.kr/api/StatisticSearch"
START = "200001"

# (id, 이름, 묶음, 통계표, 항목, 색)  - 월별(M) 값
SERIES = [
    ("base",    "기준금리",           "정책·단기", "722Y001", "0101000",  "#111827"),
    ("call",    "콜금리(1일)",        "정책·단기", "721Y001", "1010000",  "#9ca3af"),
    ("cd91",    "CD(91일)",           "정책·단기", "721Y001", "2010000",  "#a855f7"),
    ("ktb1",    "국고채(1년)",        "국고채",    "721Y001", "5030000",  "#93c5fd"),
    ("ktb2",    "국고채(2년)",        "국고채",    "721Y001", "5090000",  "#60a5fa"),
    ("ktb3",    "국고채(3년)",        "국고채",    "721Y001", "5020000",  "#2563eb"),
    ("ktb5",    "국고채(5년)",        "국고채",    "721Y001", "5040000",  "#1d4ed8"),
    ("ktb10",   "국고채(10년)",       "국고채",    "721Y001", "5050000",  "#1e3a8a"),
    ("ktb20",   "국고채(20년)",       "국고채",    "721Y001", "5060000",  "#0f766e"),
    ("ktb30",   "국고채(30년)",       "국고채",    "721Y001", "5070000",  "#134e4a"),
    ("kdb1",    "산금채(1년)",        "금융채",    "721Y001", "6050000",  "#f59e0b"),
    ("corpAA",  "회사채(3년, AA-)",   "회사채",    "721Y001", "7020000",  "#ef4444"),
    ("corpBBB", "회사채(3년, BBB-)",  "회사채",    "721Y001", "7030000",  "#991b1b"),
    ("mort",    "주택담보대출",       "대출금리",  "121Y006", "BECBLA0302",   "#16a34a"),
    ("mortFix", "고정형 주택담보대출", "대출금리", "121Y006", "BECBLA030201", "#15803d"),
    ("mortVar", "변동형 주택담보대출", "대출금리", "121Y006", "BECBLA030202", "#86efac"),
    ("jeonse",  "전세자금대출",       "대출금리",  "121Y006", "BECBLA03041",  "#65a30d"),
]
DEFAULT_ON = ["base", "ktb3", "ktb10", "corpAA", "mort"]   # 처음 화면에 켜 둘 선


def fetch(key, table, item, end):
    url = "/".join([API, key, "json", "kr", "1", "10000", table, "M", START, end, urllib.parse.quote(item)])
    with urllib.request.urlopen(url, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    if "StatisticSearch" not in d:
        msg = d.get("RESULT", {}).get("MESSAGE", d)
        sys.exit(f"ECOS 응답 오류 ({table}/{item}): {msg}")
    return {row["TIME"]: float(row["DATA_VALUE"]) for row in d["StatisticSearch"]["row"] if row["DATA_VALUE"] not in ("", None)}


def main():
    key = get_key("BOK")
    end = datetime.date.today().strftime("%Y%m")
    raw = {}
    for sid, name, _, table, item, _ in SERIES:
        raw[sid] = fetch(key, table, item, end)
        last = max(raw[sid]) if raw[sid] else "-"
        print(f"  {name}: {len(raw[sid])}개월 (마지막 {last})")

    months = sorted({m for v in raw.values() for m in v})
    out = {
        "updated": datetime.date.today().isoformat(),
        "months": months,
        "default": DEFAULT_ON,
        "series": [{"id": sid, "name": name, "group": group, "color": color,
                    "values": [raw[sid].get(m) for m in months]}
                   for sid, name, group, _, _, color in SERIES],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n→ data/macro/rates.json ({os.path.getsize(OUT) // 1024} KB), {months[0]} ~ {months[-1]}, 금리 {len(SERIES)}개")


if __name__ == "__main__":
    main()
