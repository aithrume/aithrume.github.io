# My Portfolio · 부동산·경제 데이터 분석

### 👉 사이트 바로가기: **[aithrume.github.io](https://aithrume.github.io)**

부동산학을 바탕으로, 공공·민간 데이터를 직접 받아 가공하고 지도와 그래프로 시각화하는 개인 포트폴리오입니다.
이 저장소는 사이트의 코드이고, 화면은 위 링크에서 볼 수 있습니다.

---

## 페이지

### 📈 경제 지표

| 페이지 | 내용 | 데이터 |
|---|---|---|
| [GDP 성장률](https://aithrume.github.io/gdp.html) | 실질·명목 GDP 성장률 (분기·연간) | 한국은행 ECOS |
| [금리 추이](https://aithrume.github.io/rates.html) | 기준금리·국고채·회사채·금융채·주담대 금리, 국고채 금리 곡선, 주요국 정책금리·한미 금리차 | 한국은행 ECOS, 금융투자협회 |
| [주택 공급·미분양](https://aithrume.github.io/supply.html) | 시도·시군구별 미분양·준공 후 미분양 지도, 착공·준공 실적 | 국토교통부 (KOSIS) |

### 🏢 부동산 지도

| 페이지 | 내용 | 데이터 |
|---|---|---|
| [KB 주간 아파트 시세](https://aithrume.github.io/kb.html) | 시도·시군구 주간 매매·전세 변동률 지도, KB 지수 추이, 지역 비교 그래프 | KB부동산 주간 시계열 |
| [아파트 실거래](https://aithrume.github.io/trade.html) | 월별 아파트 매매 거래량·거래가격 지도와 그래프 | 국토교통부 실거래가 (공공데이터포털) |
| [외국인 주택 소유](https://aithrume.github.io/foreign.html) | 지역 공동주택 중 외국인 소유 비율 지도 | 한국부동산원 R-ONE, 통계청 KOSIS |

### 🏔️ 취미생활

| 페이지 | 내용 |
|---|---|
| [등산 GPX 기록](https://aithrume.github.io/hiking.html) | 다녀온 산의 GPX 경로를 지형도 위에 표시 |
| [여행 지도](https://aithrume.github.io/travel.html) | 다녀온 나라·도시를 세계 지도에 표시 |
| [게임](https://aithrume.github.io/games.html) | 숫자야구, 스도쿠 |

---

## 만든 방법

- **화면:** HTML · CSS · JavaScript. 지도와 그래프는 외부 차트 라이브러리 없이 SVG로 직접 그렸습니다. 등산·여행 지도만 [Leaflet](https://leafletjs.com/)을 씁니다.
- **데이터:** Python 스크립트가 각 기관 API나 엑셀 파일에서 자료를 받아 `data/` 폴더의 JSON으로 만듭니다.
- **자동 갱신:** GitHub Actions가 매월 15일 금리·주요국 정책금리·GDP를 자동으로 받아 갱신합니다.
- **배포:** GitHub Pages

## 폴더 구조

```
├─ index.html, style.css     메인 화면
├─ *.html / *.js / *.css     각 페이지
├─ data/                     페이지가 읽는 데이터 (JSON, GPX, 지도 경계)
├─ tools/                    데이터를 만드는 Python 스크립트
└─ .github/workflows/        자동 갱신 (GitHub Actions)
```

데이터를 새로 받는 방법은 **[tools/README.md](tools/README.md)**에 정리했습니다.

## 데이터 출처

한국은행 경제통계시스템(ECOS) · 국토교통부 · 통계청 KOSIS · 한국부동산원 R-ONE · KB부동산 · 금융투자협회 채권정보센터 · 공공데이터포털.
지도 경계는 통계청 행정구역 경계(2018년 기준)를 단순화해 사용했습니다.
