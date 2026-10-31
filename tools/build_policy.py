"""
build_policy.py - 한국은행 ECOS 「국제 주요국 중앙은행 정책금리」(902Y006)를 받아 policy.html 용 data/macro/policy.json 을 만드는 스크립트

■ 사용법 (저장소 최상위 폴더에서)
    python tools/build_policy.py

  - 매달 한 번 실행해서 data/macro/policy.json 하나만 올리면 됩니다. (매번 2000년부터 전체를 새로 받음)
  - 미국은 2008.12 부터 목표 '범위'(폭 0.25%p)로 정하는데 ECOS 는 그 중간값을 줍니다.
    화면(policy.js)에서 중간값 ±0.125%p 로 상단·하단을 계산합니다.

■ 필요한 것: tools/api_keys.json 의 "BOK"(한국은행 ECOS 인증키)
"""
import os, sys, json, datetime, urllib.request, urllib.parse
from api_keys import get_key            # 같은 tools 폴더의 api_keys.py

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "macro", "policy.json")
API = "https://ecos.bok.or.kr/api/"
TABLE, START = "902Y006", "200001"

# 자주 보는 나라 색 (나머지는 회색 계열로 자동)
COLORS = {"US": "#dc2626", "KR": "#111827", "XM": "#2563eb", "JP": "#f59e0b", "GB": "#7c3aed", "CN": "#16a34a",
          "CA": "#0891b2", "AU": "#db2777", "CH": "#64748b", "IN": "#ea580c", "BR": "#65a30d"}
OTHER = ["#94a3b8", "#a78bfa", "#5eead4", "#fca5a5", "#fcd34d", "#86efac", "#93c5fd", "#f9a8d4", "#a3a3a3", "#c4b5fd",
         "#67e8f9", "#fdba74", "#bef264", "#d8b4fe", "#7dd3fc"]
ORDER = ["US", "KR", "XM", "JP", "GB", "CN"]          # 목록 앞쪽에 둘 나라
DEFAULT_ON = ["US", "KR", "XM", "JP", "GB"]


def get(*parts):
    url = API + "/".join(urllib.parse.quote(str(p)) for p in parts)
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    key, end = get_key("BOK"), datetime.date.today().strftime("%Y%m")
    items = get("StatisticItemList", key, "json", "kr", 1, 200, TABLE)["StatisticItemList"]["row"]
    countries = [(i["ITEM_CODE"], i["ITEM_NAME"]) for i in items if i["CYCLE"] == "M"]
    countries.sort(key=lambda c: (ORDER.index(c[0]) if c[0] in ORDER else 99, c[1]))
    raw = {}
    for code, name in countries:
        d = get("StatisticSearch", key, "json", "kr", 1, 10000, TABLE, "M", START, end, code)
        if "StatisticSearch" not in d:
            print(f"  [참고] {name}: 자료 없음 ({d.get('RESULT', {}).get('MESSAGE', '')})")
            continue
        raw[code] = {r["TIME"]: float(r["DATA_VALUE"]) for r in d["StatisticSearch"]["row"] if r["DATA_VALUE"] not in ("", None)}
        print(f"  {name}: {len(raw[code])}개월 (마지막 {max(raw[code])})")

    months = sorted({m for v in raw.values() for m in v})
    others = iter(OTHER)
    out = {
        "updated": datetime.date.today().isoformat(),
        "months": months,
        "default": DEFAULT_ON,
        "usRangeFrom": "200812",                        # 이 달부터 미국은 범위(중간값 ±0.125)
        "countries": [{"code": c, "name": n, "color": COLORS.get(c) or next(others),
                       "values": [raw[c].get(m) for m in months]} for c, n in countries if c in raw],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n→ data/macro/policy.json ({os.path.getsize(OUT) // 1024} KB), {months[0]} ~ {months[-1]}, {len(out['countries'])}개국")


if __name__ == "__main__":
    main()
