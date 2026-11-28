"""
build_summary.py - 메인 페이지(index.html) KPI 스냅샷 카드와 교차 분석 미니 배너용
경량 요약 파일 data/summary.json 을 생성합니다.

■ 사용법 (저장소 최상위 폴더에서)
    python tools/build_summary.py
"""
import os
import json
import datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "summary.json")


def read_json(rel_path):
    p = os.path.join(DATA, rel_path)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def last_valid(arr):
    for i in range(len(arr) - 1, -1, -1):
        if arr[i] is not None:
            return i, arr[i]
    return -1, None


def fmt_num(n):
    return f"{round(n):,}"


def fmt_price(v):
    if v is None:
        return "-"
    if v >= 10000:
        return f"{round(v / 100) / 100:.2f}".rstrip("0").rstrip(".") + "억"
    return f"{round(v):,}만"


def main():
    cards = {}

    # 1. GDP 성장률
    gdp = read_json("macro/gdp.json")
    if gdp:
        q = gdp["quarter"]
        rq = next(s["values"] for s in q["series"] if s["id"] == "realQoQ")
        ry = next(s["values"] for s in q["series"] if s["id"] == "realYoY")
        i, v = last_valid(rq)
        if i >= 0:
            p = q["periods"][i]
            yoy = ry[i]
            sign = "+" if v > 0 else ""
            yoy_s = f"전년동기비 {'+' if yoy > 0 else ''}{yoy:.1f}%" if yoy is not None else ""
            cards["gdp"] = {
                "date": f"{p[:4]} {p[4:]}",
                "label": "실질 전기비",
                "value": f"{sign}{v:.1f}%",
                "sub": yoy_s,
                "tone": "up" if v > 0 else ("down" if v < 0 else "neutral"),
            }

    # 2. 금리 추이
    rates = read_json("macro/rates.json")
    if rates:
        rm = rates["months"]
        by_id = {s["id"]: s["values"] for s in rates["series"]}
        bi, bv = last_valid(by_id["base"])
        mi, mv = last_valid(by_id["mort"])
        if bi >= 0:
            sub = ""
            tone = "neutral"
            if mi >= 0:
                prev_m = by_id["mort"][mi - 1] if mi > 0 else None
                diff_s = ""
                if prev_m is not None:
                    d = mv - prev_m
                    arrow = "▲" if d > 0.0005 else ("▼" if d < -0.0005 else "–")
                    diff_s = f" ({arrow}{abs(d):.2f}%p)"
                    tone = "up" if d > 0.0005 else ("down" if d < -0.0005 else "neutral")
                sub = f"주담대 {mv:.2f}%{diff_s}"
            cards["rates"] = {
                "date": f"{rm[bi][:4]}.{rm[bi][4:]}",
                "label": "한국 기준금리",
                "value": f"{bv:.2f}%",
                "sub": sub,
                "tone": tone,
            }

    # 3. 주택 공급·미분양
    sup = read_json("macro/supply.json")
    if sup:
        sm = sup["months"]
        nat = sup["data"].get("전국", {})
        si, sv = last_valid(nat.get("unsold", []))
        if si >= 0:
            prev = nat["unsold"][si - 1] if si > 0 else None
            after = nat.get("after", [None] * (si + 1))[si]
            parts = []
            tone = "neutral"
            if prev is not None:
                d = sv - prev
                arrow = "▲" if d > 0 else ("▼" if d < 0 else "–")
                parts.append(f"전월비 {arrow}{fmt_num(abs(d))}")
                tone = "up" if d > 0 else ("down" if d < 0 else "neutral")
            if after is not None:
                parts.append(f"준공후 {fmt_num(after)}")
            cards["supply"] = {
                "date": f"{sm[si][:4]}.{sm[si][4:]}",
                "label": "전국 미분양",
                "value": f"{fmt_num(sv)}호",
                "sub": " · ".join(parts),
                "tone": tone,
            }

    # 4. KB 주간 아파트 시세
    kbi = read_json("kb/index.json")
    kba = read_json("kb/aggregate.json")
    kbm = read_json("kb/map_sido.json")
    if kbi and kba:
        wi = len(kbi["dates"]) - 1
        dt = kbi["dates"][wi].replace("-", ".")
        sc = kba["a1"]["sc"][wi]
        jc = kba["a1"]["jc"][wi]
        seoul = next((s["id"] for s in kbi["sido"] if "서울" in s["name"]), None)
        ssc = kbm.get(seoul, {}).get("sc", [None] * (wi + 1))[wi] if (kbm and seoul) else None
        sub_parts = []
        if jc is not None:
            sub_parts.append(f"전세 {'+' if jc > 0 else ''}{jc:.2f}%")
        if ssc is not None:
            sub_parts.append(f"서울 {'+' if ssc > 0 else ''}{ssc:.2f}%")
        cards["kb"] = {
            "date": dt,
            "label": "전국 주간매매",
            "value": f"{'+' if sc > 0 else ''}{sc:.2f}%" if sc is not None else "-",
            "sub": " · ".join(sub_parts),
            "tone": "up" if (sc or 0) > 0 else ("down" if (sc or 0) < 0 else "neutral"),
        }

    # 5. 아파트 실거래 지도 (가장 최근 확정월 우선, 없으면 최신월)
    t_months = read_json("trades/months.json")
    t_bundle = read_json("trades/m_bundle.json")
    if t_months and t_months.get("months"):
        ms = t_months["months"]
        pick_m = ms[-1]
        prov_note = ""
        # 최근 달이 신고기한(30일) 미경과(집계중)이면 직전 확정월을 대표로 표시
        if len(ms) >= 2:
            last_f = (t_bundle.get(ms[-1]) if t_bundle else read_json(f"trades/m/{ms[-1]}.json")) or {}
            asof = last_f.get("asof")
            if asof:
                y, mo = int(ms[-1][:4]), int(ms[-1][4:])
                next_mo = datetime.date(y + (1 if mo == 12 else 0), 1 if mo == 12 else mo + 1, 1)
                month_end = next_mo - datetime.timedelta(days=1)
                if month_end + datetime.timedelta(days=30) > datetime.date.fromisoformat(asof):
                    pick_m = ms[-2]
                    prov_note = f" · {int(ms[-1][4:])}월 집계중"
        f = (t_bundle.get(pick_m) if t_bundle else read_json(f"trades/m/{pick_m}.json")) or {}
        nat_v = f.get("keys", {}).get("전국")
        if nat_v:
            cards["trade"] = {
                "date": f"{pick_m[:4]}.{pick_m[4:]}",
                "label": f"월 매매거래({int(pick_m[4:])}월)",
                "value": f"{fmt_num(nat_v[0])}건",
                "sub": f"중위가 {fmt_price(nat_v[1])}{prov_note}",
                "tone": "neutral",
            }

    # 6. 외국인 주택 소유
    fg = read_json("foreign/foreign.json")
    if fg and fg.get("periods"):
        fp = fg["periods"][-1]
        fd = fg["data"].get("전국", {})
        h = fd.get("h", [None])[-1]
        t = fd.get("t", [None])[-1]
        if h is not None and t:
            ratio = h / t * 100
            cards["foreign"] = {
                "date": fp["label"].replace("년 ", "."),
                "label": "외국인 소유비율",
                "value": f"{ratio:.2f}%",
                "sub": f"총 {fmt_num(h)}호 (전국 공동주택)",
                "tone": "neutral",
            }

    # 교차 분석 배너용 미니 프리뷰 시리즈 (최근 ~3년 분기 간격 서울 KB매매 & 주담대 금리)
    preview = []
    if rates and kbi:
        kb11 = read_json("kb/sido_11.json")
        seoul = next((s["id"] for s in kbi["sido"] if "서울" in s["name"]), None)
        if kb11 and seoul and seoul in kb11:
            kb_m = {}
            for i, d in enumerate(kbi["dates"]):
                ym = d[:4] + d[5:7]
                v = kb11[seoul]["si"][i]
                if v is not None:
                    kb_m[ym] = v
            rm = rates["months"]
            mort = next(s["values"] for s in rates["series"] if s["id"] == "mort")
            r_m = {rm[i]: mort[i] for i in range(len(rm)) if mort[i] is not None}
            common = sorted(set(kb_m) & set(r_m))
            recent = common[-48:]
            step = max(1, len(recent) // 16)
            picked = recent[::step]
            if recent and picked[-1] != recent[-1]:
                picked.append(recent[-1])
            preview = [[m, round(kb_m[m], 2), round(r_m[m], 2)] for m in picked]

    out_obj = {
        "updated": datetime.date.today().isoformat(),
        "cards": cards,
        "preview": preview,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out_obj, f, ensure_ascii=False, separators=(",", ":"))
    print(f"저장 완료: {OUT} ({os.path.getsize(OUT)} bytes, 카드 {len(cards)}개)")


if __name__ == "__main__":
    main()
