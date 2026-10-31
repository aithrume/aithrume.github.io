# tools 폴더 사용법

이 폴더의 파이썬 스크립트는 **내 컴퓨터에서 데이터를 만들 때만** 씁니다.
웹사이트(GitHub Pages)가 돌아가는 데는 필요 없으니, GitHub에 올리지 않아도 됩니다. (올려도 문제는 없습니다.)

> 예시 명령은 Windows 기준(`python`)입니다. Mac에서는 `python` 대신 `python3`를 쓰세요.
> 모든 명령은 **저장소 최상위 폴더**(`index.html`이 있는 곳)에서 실행합니다.

---

## 1. 폴더 구조 (중요)

`tools`와 `data`는 **같은 위치에 나란히** 있어야 합니다. 스크립트가 자기 위치를 기준으로 `../data`를 찾기 때문입니다.
(표시: ☁ = GitHub에 올림, 💻 = 내 컴퓨터에서만 사용, 올리지 않아도 됨)

```
저장소 (최상위)  ← aithrume.github.io
├─ index.html              ☁ 홈페이지 (소개 · 부동산 프로젝트 카드 · 취미생활 카드)
├─ hiking.html             ☁ 등산 GPX 기록 페이지
├─ travel.html / travel.js ☁ 여행 지도 페이지 (다녀온 곳은 data/travel.json 에 한 줄씩 추가)
├─ style.css               ☁ 홈페이지/공통 디자인
├─ hiking.js               ☁ 등산 GPX 지도·지역 필터 동작
├─ tracks.json             ☁ 산 목록 (이름·날짜·지역·gpx 파일명)
│
├─ kb.html / kb.css / kb.js          ☁ KB 주간 시세 지도 페이지
├─ trade.html / trade.css / trade.js ☁ 아파트 실거래 지도 페이지
├─ foreign.html / foreign.js         ☁ 외국인 주택 소유 비율 지도 페이지
├─ rates.html / rates.css / rates.js ☁ 주요 금리 추이 페이지
├─ gdp.html / gdp.js                 ☁ GDP 성장률 페이지 (스타일은 rates.css 공용)
├─ policy.js                         ☁ 금리 페이지 아래쪽 주요국 정책금리·한미 금리차 (policy.html 은 rates.html#policy 로 이동)
│
├─ data/                   ☁ 사이트가 읽는 데이터
│   ├─ travel.json                                 ← 여행 기록 (나라 코드·도시·좌표·방문 년월)
│   ├─ geo_world.json                              ← build_world.py 가 만든 세계 국경 (Natural Earth)
│   ├─ gpx/                                        ← 등산 GPX 파일 (9개, 산 추가 시 여기에 넣고 tracks.json에 한 줄 추가)
│   ├─ geo_sido.json, geo_sigungu.json             ← simplify_geo.py 가 만든 지도 경계 (KB·실거래 공용, 거의 안 바뀜)
│   ├─ macro/rates.json                            ← build_rates.py 가 만듦 (한국은행 금리)
│   ├─ macro/gdp.json                              ← build_gdp.py 가 만듦 (GDP 성장률)
│   ├─ macro/policy.json                           ← build_policy.py 가 만듦 (주요국 정책금리)
│   ├─ foreign/foreign.json                        ← build_foreign.py 가 만듦 (외국인 소유 비율)
│   ├─ kb/                                         ← build_data.py 가 만듦 (KB)
│   │   ├─ index.json, map_sido.json, aggregate.json
│   │   └─ sido_11.json … sido_99.json (18개)      (KB 시도별)
│   └─ trades/                                     ← build_trades.py 가 만듦 (실거래)
│       ├─ months.json, regions.json               (달 목록, 지역 목록)
│       ├─ m/202501.json … m/202608.json           (달마다 1개: 지역별 거래량·가격)
│       └─ t/202501.json … t/202608.json           (달마다 1개: 최고가 거래 TOP3)
│
├─ tools/                  💻 이 폴더 (내 컴퓨터용 도구, 올려도 무방)
│   ├─ README.md           이 문서
│   ├─ build_data.py       KB 주간 시계열 엑셀 → data/kb/*.json
│   ├─ build_trades.py     실거래가 엑셀/CSV → data/trades/ 의 월별 파일 (API 로 받기도 가능)
│   ├─ api_keys.py         API 인증키를 이름으로 꺼내 주는 도우미
│   ├─ api_keys.json       💻 실제 인증키 (GitHub 에 올리지 않음, .gitignore)
│   ├─ api_keys.example.json  api_keys.json 의 예시
│   ├─ build_rates.py      한국은행 ECOS API → data/macro/rates.json (주요 금리, 월별)
│   ├─ build_gdp.py        한국은행 ECOS API → data/macro/gdp.json (GDP 성장률, 연간·분기)
│   ├─ build_policy.py     한국은행 ECOS API → data/macro/policy.json (26개국 정책금리, 월별)
│   ├─ build_foreign.py    부동산원(R-ONE)+통계청(KOSIS) API → data/foreign/foreign.json
│   ├─ build_world.py      Natural Earth 국가 경계 → data/geo_world.json
│   └─ simplify_geo.py     지도 경계 파일 가볍게 만들기
│
└─ raw/                    💻 내려받은 원본 엑셀 보관용 (직접 만드는 폴더, 올리지 않음)
    └─ 202609.xlsx, KB주간시계열_20261019.xlsx, …
```

**페이지별로 필요한 파일**

| 페이지 | 필요한 파일 |
|---|---|
| 홈 (`index.html`) | `style.css` |
| 등산 GPX (`hiking.html`) | `style.css`, `hiking.js`, `tracks.json`, `data/gpx/` |
| KB 시세 (`kb.html`) | `kb.css`, `kb.js`, `style.css`, `data/geo_*.json`, `data/kb/` |
| 실거래 (`trade.html`) | `trade.css`, `trade.js`, `kb.css`, `style.css`, `data/geo_*.json`, `data/trades/` |

**준비물:** Python 3, 그리고 엑셀을 읽기 위한 `openpyxl`

```
pip install openpyxl
```

---

## 2. build_data.py — KB 주간 시세 데이터

KB부동산 데이터허브의 **주간 시계열 엑셀**을 `kb.html`이 읽는 JSON으로 바꿉니다.

**사용법**
```
python tools/build_data.py "KB주간시계열_20261019.xlsx"
```

**언제 쓰나:** KB가 새 주간 데이터를 내놓을 때마다. 새 엑셀을 받아서 위 명령을 다시 실행하면 전체 기간이 새로 만들어집니다. (누적 방식이 아니라, 엑셀 한 파일로 전체를 다시 만듭니다. KB 엑셀에는 2008년부터 전체가 들어 있습니다.)

**결과물:** `data/kb/` 폴더의 파일들
- `index.json` (날짜·지역 목록), `map_sido.json` (시도 지도 색칠용), `aggregate.json` (전국·수도권 등), `sido_11.json` … `sido_99.json` (시도별 시군구 시계열)

**GitHub에 올릴 것:** 바뀐 `data/kb/*.json` 전부 (새 주가 추가되면 거의 모든 파일이 바뀝니다). `data/geo_*.json`은 그대로이니 다시 올릴 필요 없습니다.

**쓰는 엑셀 시트:** `1.매매증감`, `2.전세증감`, `3.매매지수`, `4.전세지수` (이름이 바뀌면 오류가 납니다)

**자주 겪는 일**
- `[경고] … 열 이름이 다름` : 시트끼리 지역 이름이 다른 오타가 있다는 뜻입니다. 첫 시트(매매지수) 이름을 쓰고 계속 진행하니 보통은 무시해도 됩니다.
- KB가 **지역을 새로 만들거나 이름을 바꾼 경우**(예: 행정구역 개편): 스크립트 맨 위의 `SIDO` 목록에 없는 시도 이름이 생기면 그 지역이 빠집니다. 새 이름을 `SIDO`에 추가하세요.
- KB가 **지수 기준일**을 바꾼 경우(현재 2026.1.12=100): 스크립트 안의 `"base": "2026-01-12"` 줄을 고치세요.

---

## 3. build_trades.py — 아파트 실거래가

국토교통부 실거래가 공개시스템에서 받은 **아파트(매매) 엑셀 또는 CSV**를 `trade.html`이 읽는 JSON으로 바꿉니다.
**달마다 파일을 하나씩 만들고, 기존 달은 건드리지 않습니다.** 그래서 새 달만 넣으면 됩니다.

**다운로드 (실거래가 공개시스템)**
- 실거래 구분: 아파트(매매) · 계약일자: 한 달씩 · 시도: 전체 · 엑셀 다운로드
- 한 달 = 파일 1개 (파일 안의 `계약년월`을 보고 월을 구분하므로 파일 이름은 상관없습니다)

**새 달을 추가하는 순서 (이 순서만 지키면 됩니다)**
1. **저장소를 최신으로 내려받습니다.** GitHub에서 Code → Download ZIP 후 압축을 풉니다.
   (기존 달 파일이 들어 있는 `data/trades` 폴더가 있어야 합니다. 계속 쓰는 작업 폴더가 있다면 그걸 쓰세요.)
2. 새 달(그리고 직전 1~2개월) 엑셀을 작업 폴더의 `raw/` 폴더에 넣습니다. (`raw`는 GitHub에 올리지 않습니다.)
3. 작업 폴더에서 명령을 실행합니다.
   ```
   python tools/build_trades.py raw/202609.xlsx
   ```
4. 실행이 끝나면 **"GitHub 의 data/trades 폴더에 올릴 파일"** 목록이 나옵니다. 예를 들면:
   ```
   data/trades/m/202609.json
   data/trades/t/202609.json
   data/trades/months.json
   data/trades/regions.json  (변경 없음 - 올리지 않아도 됨)
   ```
5. 그 목록의 파일만 GitHub에 올립니다. 이게 전부입니다.

**동작 방식**
- 취소된 거래는 제외하고, 직거래는 포함합니다.
- 입력한 파일의 달만 `m/`·`t/`에 새로 씁니다. **같은 달을 다시 넣으면 그 달 파일만 교체**됩니다. (중복 집계 없음)
- `months.json`(달 목록)은 기존 목록에 새 달을 **더하기만** 하므로, 이전 달이 사라지지 않습니다.
- 사이트(`trade.js`)가 `m/`의 모든 달 파일을 불러와 합쳐서 보여줍니다. 합치는 작업은 내 컴퓨터가 아니라 방문자의 브라우저가 합니다.

**알아둘 점**
- 신고는 계약 후 30일까지 늦게 들어오기 때문에, 새 달을 추가할 때 **직전 1~2개월도 다시 받아 같이 넣으면** 건수가 보정됩니다. (그 달 파일만 교체됩니다.)
- 신고 기한이 안 지난 달은 화면에 "집계중"으로 표시됩니다. (파일을 만든 날짜 기준)
- 중간에 빠진 달이 있으면 경고가 나오고, 그래프에는 빈 칸으로 나옵니다.
- **기존 `data/trades/months.json`이 없는 폴더에서 실행하면 멈춥니다.** 이전 달이 사라지는 사고를 막기 위한 안전장치입니다. 이미 사이트에 데이터가 있다면 저장소를 다시 내려받은 폴더에서 실행하세요. 정말 처음 만드는 거라면 `--init`을 붙입니다.
- 이전 달 파일(`m/`, `t/`)은 GitHub에 올라가 있는 것이 원본입니다. 따로 캐시 폴더를 보관할 필요가 없습니다.

**옵션**
```
python tools/build_trades.py --init 파일1.xlsx 파일2.xlsx ...   # 처음 만들 때 (여러 달 한꺼번에)
python tools/build_trades.py --rebuild                           # 파일 없이 months/regions.json 만 다시 만들기
python tools/build_trades.py 파일.xlsx --asof 2026-11-30         # 받은 날짜를 직접 지정 (집계중 판단용)
```

**지도 경계와의 관계:** 이 스크립트는 `data/geo_sigungu.json`을 읽어 각 지역이 지도의 어느 모양인지 연결합니다(`regions.json`에 저장). 이 파일이 없으면 실행되지 않습니다.
인천 2026.7 개편 구(제물포구·영종구·서해구·검단구)처럼 2018년 지도에 없는 구는 스크립트 안의 `GROUPS`에서 개편 전 구역으로 묶어 칠합니다.

**API로 바로 받기 (엑셀 다운로드 대신):**
1. 공공데이터포털(data.go.kr)에서 두 API를 활용신청합니다: **국토교통부_아파트 매매 실거래가 상세 자료**, **행정안전부_법정동코드**
2. 받은 인증키를 `tools/api_keys.json`의 `"DATA_GO_KR"`에 넣습니다. (처음이면 `api_keys.example.json`을 복사해 이름을 바꾸세요)
   이 파일은 `.gitignore`에 들어 있어 GitHub에 올라가지 않습니다. 다른 API 키도 이 파일에 이름만 다르게 추가해 두면 `api_keys.py`의 `get_key("이름")`으로 꺼내 쓸 수 있습니다.
3. 받을 계약년월을 적어 실행합니다. 이후 과정(올릴 파일 안내 등)은 엑셀을 넣었을 때와 같습니다.
   ```
   python tools/build_trades.py --api 202610            # 그 달만
   python tools/build_trades.py --api 202301 202312     # 2023년 1월~12월 전부
   ```
   달을 두 개 적으면 그 사이의 모든 달을 받습니다(순서는 상관없음). 세 개 이상은 적을 수 없습니다.
- 한 달에 시군구 수(약 250개)만큼 호출합니다. 개발계정 하루 호출 한도(보통 1만 건) 안에서 여러 달을 받을 수 있습니다.
- 처음 실행할 때 시군구 코드 목록을 받아 `tools/lawd_codes.json`에 저장합니다. 행정구역이 바뀌면 `--refresh-codes`를 붙여 다시 받으세요.
- 엑셀과 API를 같이 넣을 수도 있습니다. 같은 달이 겹치면 API 쪽을 씁니다.

**GitHub에서 자동으로 받기 (GitHub Actions):** `.github/workflows/update-trades.yml`
- 지금은 수동 실행만 합니다: 저장소 **Actions** 탭 → **실거래가 갱신** → **Run workflow** (달을 비우면 지난달+이번 달, `202610 202609`처럼 지정도 가능)
- 받은 뒤 커밋·사이트 배포까지 자동으로 합니다. 자동 예약 실행은 파일 맨 위 설명대로 `schedule`을 추가하면 됩니다.
- API 키는 저장소 **Settings → Secrets and variables → Actions** 에 `DATA_GO_KR` 이름으로 등록해 둡니다. (`api_keys.json`은 쓰지 않음)
- Actions가 커밋하므로, 내 컴퓨터에서 작업하기 전에는 `git pull`을 먼저 하세요.

**CSV로 받았을 때:** `.csv` 파일도 그대로 넣으면 됩니다. (`openpyxl` 불필요)

---

## 4. simplify_geo.py — 지도 경계 파일 가볍게 만들기

원본 경계 GeoJSON은 너무 커서(수 MB~십수 MB) 웹에서 쓰기 어렵습니다. 점 개수를 줄여 가볍게 만듭니다.
**이미 만들어 둔 `data/geo_sido.json`, `data/geo_sigungu.json`이 있으니 보통은 다시 쓸 일이 없습니다.** 경계를 최신으로 바꾸고 싶을 때만 사용하세요.

**사용법**
```
python tools/simplify_geo.py 입력.json 출력.json 허용오차(도) [최소면적]
```

**현재 파일을 만들 때 쓴 값**
```
python tools/simplify_geo.py skorea-provinces-2018-geo.json data/geo_sido.json 0.004 0.002
python tools/simplify_geo.py skorea-municipalities-2018-geo.json data/geo_sigungu.json 0.003 0.0005
```
- 허용오차가 클수록 파일이 작아지고 모양이 거칠어집니다.
- 최소면적보다 작은 섬 조각은 버립니다.
- 원본은 통계청 2018년 기준 행정구역(southkorea-maps 프로젝트의 `skorea-provinces-2018-geo.json`, `skorea-municipalities-2018-geo.json`)입니다.

**주의:** 경계를 다른 연도 것으로 바꾸면 시군구 코드와 이름이 달라질 수 있습니다.
그러면 `build_trades.py`(`SIDO_GEO`, `GROUPS`, `SHAPE_ALIAS`)와 `kb.js`의 지역 연결을 함께 손봐야 합니다.

---

## 금리 추이 (build_rates.py)

```
python tools/build_rates.py
```
- 한국은행 ECOS에서 기준금리·시장금리(콜·CD·국고채·산금채·회사채)·주택담보대출 금리를 2000년 1월부터 월별로 받습니다.
- 필요한 키: `tools/api_keys.json`의 `"BOK"`
- 매달 한 번 실행하고 `data/macro/rates.json` 하나만 올리면 됩니다. 받을 금리는 스크립트 맨 위 `SERIES`에서 고칩니다.

## GDP 성장률 (build_gdp.py)

```
python tools/build_gdp.py
```
- 한국은행 ECOS 국민계정에서 실질·명목 GDP 성장률을 받습니다. 연간(1971~), 분기 전기 대비(계절조정)·전년 동기 대비(원계열, 2000~).
- 필요한 키: `tools/api_keys.json`의 `"BOK"`
- 분기 GDP 발표(속보치: 분기 끝나고 약 4주, 잠정치: 약 9주) 뒤에 실행하고 `data/macro/gdp.json`만 올리면 됩니다. 과거 값도 수정되므로 매번 전체를 새로 받습니다.

## 경제 지표 자동 갱신 (GitHub Actions)

`.github/workflows/update-macro.yml` 이 **매월 15일 오전 9시(한국 시간)**에 `build_rates.py` → `build_policy.py` → `build_gdp.py`를 차례로 실행하고, 바뀐 `data/macro/` 파일을 커밋해 사이트에 반영합니다.
- 직접 실행: 저장소 **Actions** 탭 → **경제 지표 갱신** → **Run workflow**
- 필요한 것: 저장소 **Settings → Secrets and variables → Actions** 에 `BOK`(한국은행 ECOS 인증키) 등록
- Actions가 커밋하므로, 내 컴퓨터에서 작업하기 전에는 `git pull`을 먼저 하세요.

## 주요국 정책금리 (build_policy.py)

```
python tools/build_policy.py
```
- 한국은행 ECOS 「국제 주요국 중앙은행 정책금리」(902Y006)에서 26개국 월말 정책금리를 2000년부터 받습니다.
- 미국은 2008.12부터 목표 범위(폭 0.25%p)인데 ECOS는 중간값을 주므로, 화면에서 ±0.125%p로 상단·하단을 계산합니다.
- 필요한 키: `tools/api_keys.json`의 `"BOK"` · 매달 한 번 실행하고 `data/macro/policy.json`만 올리면 됩니다.

## 외국인 주택 소유 지도 (build_foreign.py)

```
python tools/build_foreign.py
```
- 부동산원 R-ONE 「지역별 외국인주택소유현황_공동주택」과 통계청 KOSIS 「주택의 종류별 주택」(아파트+연립+다세대)을 받아 비율을 계산합니다.
- 필요한 키: `tools/api_keys.json`의 `"REB"`(부동산원), `"KOSIS"`(통계청)
- 반기 자료가 새로 나오면(보통 6개월마다) 다시 실행하고 `data/foreign/foreign.json` 하나만 올리면 됩니다. 매번 전체를 새로 받습니다.
- 반기마다 그 시점 기준 가장 최근 총조사를 분모로 씁니다(상반기 → 전년, 하반기 → 같은 해).

## 5. 자주 하는 작업 요약

| 하고 싶은 일 | 할 일 | 올릴 파일 |
|---|---|---|
| KB 주간 데이터 갱신 | 새 엑셀로 `build_data.py` | `data/kb/*.json` |
| 실거래 새 달 추가 | 새 달+직전 달 파일로 `build_trades.py` | 실행 후 안내되는 `data/trades/` 파일들 |
| 산(GPX) 추가 | `data/gpx/`에 파일 넣고 `tracks.json`에 한 줄 추가 (`region`도 적기) | `data/gpx/새파일`, `tracks.json` |
| 화면 모양 수정 | `style.css`, `kb.css`, `trade.css` | 수정한 파일 |

## 6. 문제가 생겼을 때

- **지도가 비어 있다 / "데이터를 불러오지 못했습니다":** GitHub에 `data/` 폴더(`data/kb/`, `data/trades/` 포함)가 통째로 올라갔는지 확인하세요. 저장소에서 `data/kb/index.json`이 열리면 정상입니다.
- **고쳤는데 화면이 그대로다:** 브라우저에서 `Ctrl+F5`. 그래도 안 되면 저장소 **Actions** 탭에서 배포가 끝났는지(초록 체크) 확인하세요.
- **내 컴퓨터에서 확인하고 싶다:** `index.html`을 더블클릭하면 데이터를 못 읽습니다. 저장소 폴더에서 `python -m http.server` 실행 후 `http://localhost:8000`으로 여세요.
- **스크립트 오류가 났다:** 화면에 나온 마지막 오류 줄을 복사해서 알려주면 원인을 찾기 쉽습니다.
