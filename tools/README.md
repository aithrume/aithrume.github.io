# tools 폴더 사용법

이 폴더의 파이썬 스크립트는 **내 컴퓨터에서 데이터를 만들 때만** 씁니다.
웹사이트(GitHub Pages)가 돌아가는 데는 필요 없으니, GitHub에 올리지 않아도 됩니다. (올려도 문제는 없습니다.)

> Windows에서는 `python3` 대신 `python` 또는 `py`를 쓰세요.
> 모든 명령은 **저장소 최상위 폴더**(`index.html`이 있는 곳)에서 실행합니다.

---

## 1. 폴더 구조 (중요)

`tools`와 `data`는 **같은 위치에 나란히** 있어야 합니다. 스크립트가 자기 위치를 기준으로 `../data`를 찾기 때문입니다.

```
저장소 (최상위)
├─ index.html, style.css, hiking.js, tracks.json
├─ kb.html / kb.css / kb.js          KB 시세 지도 페이지
├─ trade.html / trade.css / trade.js 실거래 지도 페이지
├─ gpx/                               등산 GPX 파일
├─ data/                              사이트가 읽는 데이터 (GitHub에 올림)
│   ├─ index.json, map_sido.json, aggregate.json, sido_XX.json   ← build_data.py 가 만듦
│   ├─ geo_sido.json, geo_sigungu.json                           ← simplify_geo.py 가 만든 지도 경계
│   └─ trades/
│       ├─ series.json, top.json                                 ← build_trades.py 가 만듦
└─ tools/                             이 폴더 (내 컴퓨터용 도구)
    ├─ README.md                      이 문서
    ├─ build_data.py                  KB 주간 시계열 엑셀 → data/*.json
    ├─ build_trades.py                실거래가 엑셀/CSV → data/trades/*.json
    ├─ simplify_geo.py                지도 경계 파일 가볍게 만들기
    └─ trade_cache/                   실거래 월별 집계 저장소 (지우지 마세요!)
```

**준비물:** Python 3, 그리고 엑셀을 읽기 위한 `openpyxl`

```
pip install openpyxl
```

---

## 2. build_data.py — KB 주간 시세 데이터

KB부동산 데이터허브의 **주간 시계열 엑셀**을 `kb.html`이 읽는 JSON으로 바꿉니다.

**사용법**
```
python3 tools/build_data.py "KB주간시계열_20261019.xlsx"
```

**언제 쓰나:** KB가 새 주간 데이터를 내놓을 때마다. 새 엑셀을 받아서 위 명령을 다시 실행하면 전체 기간이 새로 만들어집니다. (누적 방식이 아니라, 엑셀 한 파일로 전체를 다시 만듭니다. KB 엑셀에는 2008년부터 전체가 들어 있습니다.)

**결과물:** `data/` 폴더의 파일들
- `index.json` (날짜·지역 목록), `map_sido.json` (시도 지도 색칠용), `aggregate.json` (전국·수도권 등), `sido_11.json` … `sido_99.json` (시도별 시군구 시계열)

**GitHub에 올릴 것:** 바뀐 `data/*.json` 전부 (새 주가 추가되면 거의 모든 파일이 바뀝니다). `geo_*.json`은 그대로이니 다시 올릴 필요 없습니다.

**쓰는 엑셀 시트:** `1.매매증감`, `2.전세증감`, `3.매매지수`, `4.전세지수` (이름이 바뀌면 오류가 납니다)

**자주 겪는 일**
- `[경고] … 열 이름이 다름` : 시트끼리 지역 이름이 다른 오타가 있다는 뜻입니다. 첫 시트(매매지수) 이름을 쓰고 계속 진행하니 보통은 무시해도 됩니다.
- KB가 **지역을 새로 만들거나 이름을 바꾼 경우**(예: 행정구역 개편): 스크립트 맨 위의 `SIDO` 목록에 없는 시도 이름이 생기면 그 지역이 빠집니다. 새 이름을 `SIDO`에 추가하세요.
- KB가 **지수 기준일**을 바꾼 경우(현재 2026.1.12=100): 스크립트 안의 `"base": "2026-01-12"` 줄을 고치세요.

---

## 3. build_trades.py — 아파트 실거래가

국토교통부 실거래가 공개시스템에서 받은 **아파트(매매) 엑셀 또는 CSV**를 `trade.html`이 읽는 JSON으로 바꿉니다.
**월별로 쌓아가는 방식**이라, 새 달만 추가하면 됩니다.

**다운로드 (실거래가 공개시스템)**
- 실거래 구분: 아파트(매매) · 계약일자: 한 달씩 · 시도: 전체 · 엑셀 다운로드
- 한 달 = 파일 1개 (파일 안의 `계약년월`을 보고 알아서 월을 구분하므로 파일 이름은 상관없습니다)

**사용법**
```
python3 tools/build_trades.py 새파일1.xlsx 새파일2.xlsx
```
여러 파일을 한꺼번에 넣어도 됩니다.

**동작 방식**
1. 파일을 읽어 월별로 집계합니다. (취소된 거래는 제외, 직거래는 포함)
2. 집계 결과를 `tools/trade_cache/YYYYMM.json`에 저장합니다. **원본 엑셀은 보관하지 않아도 됩니다.**
3. 캐시 전체를 합쳐 `data/trades/series.json`, `data/trades/top.json`을 새로 만듭니다.

**데이터를 추가하는 순서**
1. 새 달 파일(그리고 직전 1~2개월 파일)을 다운로드
2. 위 명령 실행
3. `data/trades/series.json`, `data/trades/top.json` 두 파일만 GitHub에 다시 올림

**알아둘 점**
- **같은 달을 다시 넣으면 그 달만 교체**됩니다(중복 집계 없음). 신고가 계약 후 30일까지 늦게 들어오기 때문에, 새 달을 추가할 때 **직전 1~2개월도 다시 받아서 덮어쓰기**를 권합니다.
- 신고 기한(30일)이 안 지난 달은 화면에 "집계중"으로 표시됩니다. (스크립트를 실행한 날짜 기준)
- 중간에 빠진 달이 있으면 경고가 나오고, 그래프에는 빈 칸으로 나옵니다.
- **`tools/trade_cache/`를 지우면** 이전 달을 전부 다시 변환해야 합니다. 폴더를 꼭 보관하세요. (백업 용도로 다른 곳에 복사해 둬도 좋습니다.)
- 집계 규칙(예: 가격 통계 최소 거래 수 5건)이나 지역 묶음을 바꾸면, 캐시가 아니라 **원본 파일을 다시 넣어야** 반영됩니다. 단, 아래의 `--rebuild`로 되는 변경도 있습니다.

**옵션**
```
python3 tools/build_trades.py --rebuild              # 새 파일 없이, 캐시로 JSON만 다시 만들기
python3 tools/build_trades.py 파일.xlsx --asof 2026-11-30   # 받은 날짜를 직접 지정 (집계중 판단용)
```

**지도 경계와의 관계:** 이 스크립트는 `data/geo_sigungu.json`을 읽어 각 지역이 지도의 어느 모양인지 연결합니다. 이 파일이 없으면 실행되지 않습니다.
인천 2026.7 개편 구(제물포구·영종구·서해구·검단구)처럼 2018년 지도에 없는 구는 스크립트 안의 `GROUPS`에서 개편 전 구역으로 묶어 칠합니다.

**CSV로 받았을 때:** `.csv` 파일도 그대로 넣으면 됩니다. (`openpyxl` 불필요)

---

## 4. simplify_geo.py — 지도 경계 파일 가볍게 만들기

원본 경계 GeoJSON은 너무 커서(수 MB~십수 MB) 웹에서 쓰기 어렵습니다. 점 개수를 줄여 가볍게 만듭니다.
**이미 만들어 둔 `data/geo_sido.json`, `data/geo_sigungu.json`이 있으니 보통은 다시 쓸 일이 없습니다.** 경계를 최신으로 바꾸고 싶을 때만 사용하세요.

**사용법**
```
python3 tools/simplify_geo.py 입력.json 출력.json 허용오차(도) [최소면적]
```

**현재 파일을 만들 때 쓴 값**
```
python3 tools/simplify_geo.py skorea-provinces-2018-geo.json data/geo_sido.json 0.004 0.002
python3 tools/simplify_geo.py skorea-municipalities-2018-geo.json data/geo_sigungu.json 0.003 0.0005
```
- 허용오차가 클수록 파일이 작아지고 모양이 거칠어집니다.
- 최소면적보다 작은 섬 조각은 버립니다.
- 원본은 통계청 2018년 기준 행정구역(southkorea-maps 프로젝트의 `skorea-provinces-2018-geo.json`, `skorea-municipalities-2018-geo.json`)입니다.

**주의:** 경계를 다른 연도 것으로 바꾸면 시군구 코드와 이름이 달라질 수 있습니다.
그러면 `build_trades.py`(`SIDO_GEO`, `GROUPS`, `SHAPE_ALIAS`)와 `kb.js`의 지역 연결을 함께 손봐야 합니다.

---

## 5. 자주 하는 작업 요약

| 하고 싶은 일 | 할 일 | 올릴 파일 |
|---|---|---|
| KB 주간 데이터 갱신 | 새 엑셀로 `build_data.py` | `data/*.json` (geo 제외) |
| 실거래 새 달 추가 | 새 달+직전 달 파일로 `build_trades.py` | `data/trades/series.json`, `top.json` |
| 산(GPX) 추가 | `gpx/`에 파일 넣고 `tracks.json`에 한 줄 추가 (`region`도 적기) | `gpx/새파일`, `tracks.json` |
| 화면 모양 수정 | `style.css`, `kb.css`, `trade.css` | 수정한 파일 |

## 6. 문제가 생겼을 때

- **지도가 비어 있다 / "데이터를 불러오지 못했습니다":** GitHub에 `data/` 폴더(또는 `data/trades/`)가 통째로 올라갔는지 확인하세요. 저장소에서 `data/index.json`이 열리면 정상입니다.
- **고쳤는데 화면이 그대로다:** 브라우저에서 `Ctrl+F5`. 그래도 안 되면 저장소 **Actions** 탭에서 배포가 끝났는지(초록 체크) 확인하세요.
- **내 컴퓨터에서 확인하고 싶다:** `index.html`을 더블클릭하면 데이터를 못 읽습니다. 저장소 폴더에서 `python3 -m http.server` 실행 후 `http://localhost:8000`으로 여세요.
- **스크립트 오류가 났다:** 화면에 나온 마지막 오류 줄을 복사해서 알려주면 원인을 찾기 쉽습니다.
