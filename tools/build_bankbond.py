r"""
build_bankbond.py - 금융채(은행채) 만기별 금리 파일(일별)을 월말 값으로 바꿔 data/macro/bankbond.json 에 저장하는 스크립트

■ 준비: 금융투자협회 채권정보센터에서 「금융채 I(은행채) 무보증 AAA」 6개월·1년·3년·5년 시가평가 수익률(일별)을
        텍스트(.txt, 탭 구분)로 내려받습니다. 첫 3줄은 머리글, 그 아래 '날짜 / 6월 / 1년 / 3년 / 5년' 순서.
        한글 Windows 에서 받은 파일은 CP949 인코딩이라 그대로 읽습니다.

■ 사용법 (저장소 최상위 폴더에서)
    python tools/build_bankbond.py "..\github_data\금융채_금리.txt"
    python tools/build_rates.py                  ← 금리 추이(rates.json)에 합치기

  - 달마다 '그 달 마지막 날(휴일이면 마지막 거래일)' 금리를 그 달 값으로 씁니다.
  - 이미 저장된 달은 지우지 않고, 파일에 있는 달만 새 값으로 바꿉니다. 그래서 다음에는 최근 몇 달 치만 받아 넣어도 됩니다.
"""
import os, sys, json, datetime

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
OUT = os.path.join(ROOT, "data", "macro", "bankbond.json")
TENORS = ["6m", "1y", "3y", "5y"]                    # 파일의 2~5번째 칸 순서


def read_text(path):
    raw = open(path, "rb").read()
    for enc in ("utf-8-sig", "cp949"):                # 엑셀이 저장한 한글 텍스트는 보통 CP949
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    sys.exit("파일 인코딩을 알 수 없습니다 (UTF-8, CP949 둘 다 아님): " + path)


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rows = [line.split("\t") for line in read_text(sys.argv[1]).splitlines()]
    month_end = {}                                    # 'YYYYMM' → (날짜, [6m, 1y, 3y, 5y])
    for r in rows:
        if len(r) < 5 or not r[0][:4].isdigit():
            continue                                  # 머리글·빈 줄
        day = r[0].strip().replace("/", "-").replace(".", "-")
        try:
            datetime.date.fromisoformat(day)
            vals = [float(x) if x.strip() not in ("", "-") else None for x in r[1:5]]
        except ValueError:
            print("  [건너뜀] 읽을 수 없는 줄:", "\t".join(r))
            continue
        m = day[:4] + day[5:7]
        if m not in month_end or day > month_end[m][0]:
            month_end[m] = (day, vals)
    if not month_end:
        sys.exit("금리 줄을 하나도 찾지 못했습니다. 파일 형식을 확인하세요.")

    old = json.load(open(OUT, encoding="utf-8")) if os.path.exists(OUT) else {"months": {}}
    merged = dict(old["months"])
    for m, (day, vals) in month_end.items():
        merged[m] = {"date": day, **dict(zip(TENORS, vals))}
    out = {"updated": datetime.date.today().isoformat(),
           "source": "금융투자협회 채권정보센터, 금융채 I(은행채) 무보증 AAA 시가평가 수익률(5사 평균), 월말 값",
           "months": dict(sorted(merged.items()))}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    ks = list(out["months"])
    print(f"파일: {len(month_end)}개월 ({min(month_end)} ~ {max(month_end)}), 새로 추가 {len(set(month_end) - set(old['months']))}개월")
    print(f"→ data/macro/bankbond.json : 전체 {len(ks)}개월 ({ks[0]} ~ {ks[-1]})")
    print("이제 python tools/build_rates.py 를 실행하면 금리 추이에 합쳐집니다.")


if __name__ == "__main__":
    main()
