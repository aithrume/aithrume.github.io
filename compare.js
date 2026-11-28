/* =========================================================
   compare.js - 부동산 시장 교차 분석 (금리 · KB시세 · 실거래 · 공급/미분양)
   기존 data/ JSON을 브라우저에서 월(YYYYMM) 단위로 결합해 이중 축 SVG로 시각화
   ========================================================= */
(function () {
  'use strict';

  var C = window.ChartCore;
  var $ = C.$, el = C.el, fetchJson = C.fetchJson, fmtNum = C.fmtNum, ymDot = C.ymDot;

  var REGIONS = [
    { key: '전국', label: '전국', kbFile: 'agg', kbId: 'a1', trade: '전국', supply: '전국' },
    { key: '서울', label: '서울특별시', kbFile: '11', kbId: 's11', trade: '서울특별시', supply: '서울' },
    { key: '경기', label: '경기도', kbFile: '31', kbId: 's31', trade: '경기도', supply: '경기' },
    { key: '인천', label: '인천광역시', kbFile: '23', kbId: 's23', trade: '인천광역시', supply: '인천' },
    { key: '부산', label: '부산광역시', kbFile: '21', kbId: 's21', trade: '부산광역시', supply: '부산' },
    { key: '대구', label: '대구광역시', kbFile: '22', kbId: 's22', trade: '대구광역시', supply: '대구' },
    { key: '광주', label: '광주광역시', kbFile: '24', kbId: 's24', trade: '광주광역시', supply: '광주전남', supplyNote: '광주·전남 합산' },
    { key: '대전', label: '대전광역시', kbFile: '25', kbId: 's25', trade: '대전광역시', supply: '대전' },
    { key: '울산', label: '울산광역시', kbFile: '26', kbId: 's26', trade: '울산광역시', supply: '울산' },
    { key: '세종', label: '세종특별자치시', kbFile: '29', kbId: 's29', trade: '세종특별자치시', supply: '세종' },
    { key: '강원', label: '강원특별자치도', kbFile: '32', kbId: 's32', trade: '강원특별자치도', supply: '강원' },
    { key: '충북', label: '충청북도', kbFile: '33', kbId: 's33', trade: '충청북도', supply: '충북' },
    { key: '충남', label: '충청남도', kbFile: '34', kbId: 's34', trade: '충청남도', supply: '충남' },
    { key: '전북', label: '전북특별자치도', kbFile: '35', kbId: 's35', trade: '전북특별자치도', supply: '전북' },
    { key: '전남', label: '전라남도', kbFile: '36', kbId: 's36', trade: '전라남도', supply: '광주전남', supplyNote: '광주·전남 합산' },
    { key: '경북', label: '경상북도', kbFile: '37', kbId: 's37', trade: '경상북도', supply: '경북' },
    { key: '경남', label: '경상남도', kbFile: '38', kbId: 's38', trade: '경상남도', supply: '경남' },
    { key: '제주', label: '제주특별자치도', kbFile: '39', kbId: 's39', trade: '제주특별자치도', supply: '제주' }
  ];
  var byKey = {};
  REGIONS.forEach(function (r) { byKey[r.key] = r; });

  var state = { region: '서울', years: 5 };
  var ratesData, supplyData, kbIndex, kbAgg, tradeMonths, tradeBundle;
  var kbCache = {};
  var renderToken = 0;

  // KB 주간 데이터 → 월말 기준 딕셔너리
  function toMonthlyKb(seriesObj) {
    var out = {};
    kbIndex.dates.forEach(function (d, i) {
      var ym = d.slice(0, 4) + d.slice(5, 7);
      if (seriesObj.si[i] != null || seriesObj.ji[i] != null) {
        out[ym] = { si: seriesObj.si[i], ji: seriesObj.ji[i] };
      }
    });
    return out;
  }

  function loadKbSeries(reg) {
    if (reg.kbFile === 'agg') return Promise.resolve(kbAgg[reg.kbId]);
    if (!kbCache[reg.kbFile]) {
      kbCache[reg.kbFile] = fetchJson('data/kb/sido_' + reg.kbFile + '.json');
    }
    return kbCache[reg.kbFile].then(function (d) { return d[reg.kbId]; });
  }

  function buildAligned(reg, kbSeries) {
    var rateById = {};
    ratesData.series.forEach(function (s) { rateById[s.id] = s.values; });
    var rMap = {};
    ratesData.months.forEach(function (m, i) {
      rMap[m] = { base: rateById.base[i], mort: rateById.mort[i] };
    });

    var kbMap = toMonthlyKb(kbSeries);

    var supSeries = supplyData.data[reg.supply] || {};
    var sMap = {};
    supplyData.months.forEach(function (m, i) {
      var start12 = null, done12 = null;
      if (i >= 11 && supSeries.start && supSeries.done) {
        var sSum = 0, dSum = 0, okS = true, okD = true;
        for (var j = i - 11; j <= i; j++) {
          if (supSeries.start[j] == null) okS = false; else sSum += supSeries.start[j];
          if (supSeries.done[j] == null) okD = false; else dSum += supSeries.done[j];
        }
        if (okS) start12 = sSum;
        if (okD) done12 = dSum;
      }
      sMap[m] = {
        unsold: supSeries.unsold ? supSeries.unsold[i] : null,
        after: supSeries.after ? supSeries.after[i] : null,
        start12: start12,
        done12: done12
      };
    });

    var tMap = {};
    tradeMonths.forEach(function (m) {
      var f = tradeBundle[m];
      var v = f && f.keys && f.keys[reg.trade];
      if (v) tMap[m] = { vol: v[0], med: v[1] };
    });

    var monthSet = {};
    Object.keys(kbMap).forEach(function (m) { monthSet[m] = true; });
    Object.keys(rMap).forEach(function (m) { if (m >= '200801') monthSet[m] = true; });
    var months = Object.keys(monthSet).sort();

    return months.map(function (m) {
      var r = rMap[m] || {}, k = kbMap[m] || {}, s = sMap[m] || {}, t = tMap[m] || {};
      return {
        m: m,
        base: r.base != null ? r.base : null,
        mort: r.mort != null ? r.mort : null,
        si: k.si != null ? k.si : null,
        ji: k.ji != null ? k.ji : null,
        unsold: s.unsold != null ? s.unsold : null,
        start12: s.start12 != null ? s.start12 : null,
        done12: s.done12 != null ? s.done12 : null,
        vol: t.vol != null ? t.vol : null,
        med: t.med != null ? t.med : null
      };
    });
  }

  function lastValid(rows, key) {
    for (var i = rows.length - 1; i >= 0; i--) {
      if (rows[i][key] != null) return rows[i];
    }
    return null;
  }

  function fmtK(v) {
    if (v >= 10000) return +(v / 10000).toFixed(1) + '만';
    return fmtNum(v);
  }

  function drawXTicks(svg, rows, X, y) {
    var n = rows.length, every = n > 144 ? 3 : n > 72 ? 2 : 1;
    rows.forEach(function (r, i) {
      if (n <= 36 ? (r.m.slice(4) === '01' || r.m.slice(4) === '07') : (r.m.slice(4) === '01' && +r.m.slice(0, 4) % every === 0)) {
        el('text', { x: X(i), y: y, 'text-anchor': 'middle' }, svg).textContent = n <= 36 ? ymDot(r.m) : r.m.slice(0, 4);
      }
    });
  }

  function drawLinePath(svg, rows, key, X, Y, color, width, step, dash) {
    var d = '', pen = false;
    rows.forEach(function (r, i) {
      var v = r[key];
      if (v == null) { pen = false; return; }
      var x = X(i).toFixed(1), y = Y(v).toFixed(1);
      d += pen ? (step ? 'H' + x + 'V' + y : 'L' + x + ',' + y) : 'M' + x + ',' + y;
      pen = true;
    });
    if (!d) return;
    var a = { d: d, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linejoin': 'round' };
    if (dash) a['stroke-dasharray'] = dash;
    el('path', a, svg);
  }

  function bindCrosshair(svg, rows, X, W, ML, MR, MT, H, MB, onShow) {
    var pw = W - ML - MR, ph = H - MT - MB;
    var cross = el('line', { y1: MT, y2: H - MB, stroke: '#64748b', 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
    var hit = el('rect', { x: ML, y: MT, width: pw, height: ph, fill: 'transparent', style: 'cursor:crosshair' }, svg);
    hit.addEventListener('pointermove', function (e) {
      var rect = svg.getBoundingClientRect();
      var px = (e.clientX - rect.left) * (W / rect.width);
      var i = Math.max(0, Math.min(rows.length - 1, Math.round((px - ML) / pw * (rows.length - 1))));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      onShow(i);
    });
    hit.addEventListener('pointerleave', function () {
      cross.setAttribute('visibility', 'hidden');
      onShow(rows.length - 1);
    });
    onShow(rows.length - 1);
  }

  function renderSummary(reg, rows) {
    $('summary-title').textContent = reg.label + ' 최신 현황';
    var rKb = lastValid(rows, 'si');
    var rBase = lastValid(rows, 'base');
    var rMort = lastValid(rows, 'mort');
    var rVol = lastValid(rows, 'vol');
    var rSup = lastValid(rows, 'unsold');
    $('summary-date').textContent = rKb ? ymDot(rKb.m) + ' 기준' : '';

    var tiles = [
      {
        name: 'KB 매매지수', color: '#2563eb',
        num: rKb ? rKb.si.toFixed(1) : '-',
        sub: rKb ? ymDot(rKb.m) + ' · 전세 ' + (rKb.ji != null ? rKb.ji.toFixed(1) : '-') : ''
      },
      {
        name: '한국 기준금리', color: '#f59e0b',
        num: rBase ? rBase.base.toFixed(2) + '%' : '-',
        sub: rMort ? '주담대 ' + rMort.mort.toFixed(2) + '% (' + ymDot(rMort.m) + ')' : ''
      },
      {
        name: '최근 월 실거래량', color: '#64748b',
        num: rVol ? fmtNum(rVol.vol) + '건' : '-',
        sub: rVol ? ymDot(rVol.m) + (rVol.med ? ' · 중위가 ' + (rVol.med >= 10000 ? (rVol.med / 10000).toFixed(2) + '억' : fmtNum(rVol.med) + '만') : '') : ''
      },
      {
        name: '미분양' + (reg.supplyNote ? ' (' + reg.supplyNote + ')' : ''), color: '#dc2626',
        num: rSup ? fmtNum(rSup.unsold) + '호' : '-',
        sub: rSup && rSup.done12 != null ? ymDot(rSup.m) + ' · 최근1년 준공 ' + fmtNum(rSup.done12) + '호' : (rSup ? ymDot(rSup.m) : '')
      }
    ];
    $('summary-tiles').innerHTML = tiles.map(function (t) {
      return '<div class="rate-tile" style="--tile-color:' + t.color + '">' +
        '<span class="name">' + t.name + '</span>' +
        '<span class="num">' + t.num + '</span>' +
        '<span class="chg"><span class="muted">' + t.sub + '</span></span></div>';
    }).join('');

    C.renderCrossLinks('cross-links', 'compare', reg.key, null);
  }

  // ① 금리 vs KB 매매지수 · 실거래량
  function renderRateChart(reg, rows) {
    $('t-rate').textContent = reg.label + ' KB 매매지수 · 실거래량 vs 주담대·기준금리';
    var svg = $('svg-rate');
    svg.innerHTML = '';
    var W = 960, H = 360, ML = 56, MR = 58, MT = 18, MB = 34;
    var pw = W - ML - MR, ph = H - MT - MB, n = rows.length;
    function X(i) { return ML + (n > 1 ? i / (n - 1) : 0.5) * pw; }

    var siVals = rows.map(function (r) { return r.si; }).filter(function (v) { return v != null; });
    var rVals = [];
    rows.forEach(function (r) { if (r.base != null) rVals.push(r.base); if (r.mort != null) rVals.push(r.mort); });
    var vVals = rows.map(function (r) { return r.vol; }).filter(function (v) { return v != null; });

    var RL = C.niceRange(Math.min.apply(null, siVals), Math.max.apply(null, siVals), { padMin: true });
    var RR = C.niceRange(0, Math.max.apply(null, rVals), { clampZero: true });
    var vMax = vVals.length ? Math.max.apply(null, vVals) * 1.15 : 1;

    function YL(v) { return MT + (1 - (v - RL.min) / (RL.max - RL.min)) * ph; }
    function YR(v) { return MT + (1 - (v - RR.min) / (RR.max - RR.min)) * ph; }

    for (var k = 0; k <= 4; k++) {
      var y = MT + (k / 4) * ph;
      var lv = RL.max - (k / 4) * (RL.max - RL.min);
      var rv = RR.max - (k / 4) * (RR.max - RR.min);
      el('line', { x1: ML, x2: W - MR, y1: y, y2: y, 'class': k === 4 ? 'axis' : 'grid' }, svg);
      el('text', { x: ML - 8, y: y + 4, 'text-anchor': 'end', style: 'fill:#2563eb' }, svg).textContent = lv.toFixed(0);
      el('text', { x: W - MR + 8, y: y + 4, 'text-anchor': 'start', style: 'fill:#dc2626' }, svg).textContent = rv.toFixed(1) + '%';
    }
    drawXTicks(svg, rows, X, H - 10);

    // 거래량 막대 (하단 45%)
    var bw = Math.max(2, pw / n * 0.65);
    rows.forEach(function (r, i) {
      if (r.vol == null) return;
      var bh = (r.vol / vMax) * (ph * 0.45);
      el('rect', { x: X(i) - bw / 2, y: H - MB - bh, width: bw, height: bh, fill: '#cbd5e1', opacity: 0.72, rx: 1 }, svg);
    });

    drawLinePath(svg, rows, 'base', X, YR, '#f59e0b', 2, true, '5 3');
    drawLinePath(svg, rows, 'mort', X, YR, '#dc2626', 2.2, false);
    drawLinePath(svg, rows, 'si', X, YL, '#2563eb', 2.8, false);

    bindCrosshair(svg, rows, X, W, ML, MR, MT, H, MB, function (i) {
      var r = rows[i];
      $('info-rate').textContent = ymDot(r.m) +
        ' · 매매지수 ' + (r.si != null ? r.si.toFixed(1) : '-') +
        ' · 월 거래량 ' + (r.vol != null ? fmtNum(r.vol) + '건' : '자료없음') +
        ' · 주담대 ' + (r.mort != null ? r.mort.toFixed(2) + '%' : '-') +
        ' · 기준금리 ' + (r.base != null ? r.base.toFixed(2) + '%' : '-');
    });

    // 자동 요약 해석 메모
    var firstSi = rows.find(function (r) { return r.si != null; });
    var lastSi = lastValid(rows, 'si');
    var lastBase = lastValid(rows, 'base');
    var peakSi = rows.reduce(function (a, b) { return (b.si != null && (!a || b.si > a.si)) ? b : a; }, null);
    var chg = firstSi && lastSi ? ((lastSi.si / firstSi.si - 1) * 100) : null;
    $('note-rate').innerHTML = '<strong>해석 메모</strong>' +
      reg.label + ' 매매지수는 선택 기간(' + ymDot(rows[0].m) + '~' + ymDot(rows[n - 1].m) + ') 동안 ' +
      (chg != null ? ((chg >= 0 ? '+' : '') + chg.toFixed(1) + '% 변동') : '') +
      (peakSi ? '했으며, 기간 내 최고점은 ' + ymDot(peakSi.m) + '(' + peakSi.si.toFixed(1) + ')입니다. ' : '. ') +
      '보통 주담대 금리(빨강)와 기준금리(주황)의 방향 전환 이후 월 거래량(회색 막대)이 먼저 반응하고, 수개월 시차를 두고 매매지수(파랑) 흐름이 따라 움직이는 경향을 확인할 수 있습니다.' +
      (lastBase ? ' (최근 기준금리 ' + lastBase.base.toFixed(2) + '%)' : '');
  }

  // ② 매매 vs 전세 및 상대강도
  function renderRatioChart(reg, rows) {
    $('t-ratio').textContent = reg.label + ' 매매 vs 전세 지수 · 상대강도 (전세÷매매)';
    var svg = $('svg-ratio');
    svg.innerHTML = '';
    var W = 960, H = 340, ML = 56, MR = 58, MT = 18, MB = 34;
    var pw = W - ML - MR, ph = H - MT - MB, n = rows.length;
    function X(i) { return ML + (n > 1 ? i / (n - 1) : 0.5) * pw; }

    var firstBoth = rows.find(function (r) { return r.si != null && r.ji != null; });
    var baseRatio = firstBoth ? (firstBoth.ji / firstBoth.si) : 1;
    var enriched = rows.map(function (r) {
      return { m: r.m, si: r.si, ji: r.ji, rel: (r.si != null && r.ji != null) ? (r.ji / r.si) / baseRatio * 100 : null };
    });

    var lVals = [], rVals = [];
    enriched.forEach(function (r) {
      if (r.si != null) lVals.push(r.si);
      if (r.ji != null) lVals.push(r.ji);
      if (r.rel != null) rVals.push(r.rel);
    });
    var RL = C.niceRange(Math.min.apply(null, lVals), Math.max.apply(null, lVals), { padMin: true });
    var RR = C.niceRange(Math.min.apply(null, rVals), Math.max.apply(null, rVals), { padMin: true });
    function YL(v) { return MT + (1 - (v - RL.min) / (RL.max - RL.min)) * ph; }
    function YR(v) { return MT + (1 - (v - RR.min) / (RR.max - RR.min)) * ph; }

    for (var k = 0; k <= 4; k++) {
      var y = MT + (k / 4) * ph;
      var lv = RL.max - (k / 4) * (RL.max - RL.min);
      var rv = RR.max - (k / 4) * (RR.max - RR.min);
      el('line', { x1: ML, x2: W - MR, y1: y, y2: y, 'class': k === 4 ? 'axis' : 'grid' }, svg);
      el('text', { x: ML - 8, y: y + 4, 'text-anchor': 'end' }, svg).textContent = lv.toFixed(0);
      el('text', { x: W - MR + 8, y: y + 4, 'text-anchor': 'start', style: 'fill:#0d9488' }, svg).textContent = rv.toFixed(0);
    }
    if (100 >= RR.min && 100 <= RR.max) {
      el('line', { x1: ML, x2: W - MR, y1: YR(100), y2: YR(100), stroke: '#99f6e4', 'stroke-dasharray': '3 3' }, svg);
    }
    drawXTicks(svg, enriched, X, H - 10);

    drawLinePath(svg, enriched, 'si', X, YL, '#2563eb', 2.6, false);
    drawLinePath(svg, enriched, 'ji', X, YL, '#f59e0b', 2.4, false);
    drawLinePath(svg, enriched, 'rel', X, YR, '#0d9488', 2.1, false, '6 3');

    bindCrosshair(svg, enriched, X, W, ML, MR, MT, H, MB, function (i) {
      var r = enriched[i];
      $('info-ratio').textContent = ymDot(r.m) +
        ' · 매매지수 ' + (r.si != null ? r.si.toFixed(1) : '-') +
        ' · 전세지수 ' + (r.ji != null ? r.ji.toFixed(1) : '-') +
        ' · 전세÷매매 상대강도 ' + (r.rel != null ? r.rel.toFixed(1) : '-') +
        (firstBoth ? ' (' + ymDot(firstBoth.m) + '=100)' : '');
    });

    var lastRel = lastValid(enriched, 'rel');
    var relTxt = lastRel
      ? (lastRel.rel > 101 ? '기간 시작 대비 전세가 매매보다 상대적으로 더 강세(상대강도 ' + lastRel.rel.toFixed(1) + ')를 보여 실수요 하방 지지력이 높은 구간입니다.'
        : lastRel.rel < 99 ? '기간 시작 대비 매매가 전세보다 더 빠르게 상승(상대강도 ' + lastRel.rel.toFixed(1) + ')해 매매·전세 격차가 넓어진 구간입니다.'
        : '기간 시작 시점과 매매·전세 비율이 거의 균형(상대강도 ' + lastRel.rel.toFixed(1) + ')을 이루고 있습니다.')
      : '';
    $('note-ratio').innerHTML = '<strong>해석 메모</strong>' +
      '전세÷매매 상대강도(청록 점선)가 오르면 전세가 매매보다 강해 갭이 줄어드는 흐름을, 내려가면 매매가 전세보다 더 강하게 오르거나 전세가 먼저 빠지는 흐름을 뜻합니다. ' +
      reg.label + '의 경우 현재 ' + relTxt;
  }

  // ③ 공급 시차(12개월 누적 착공·준공) vs 미분양
  function renderSupplyChart(reg, rows) {
    $('t-supply').textContent = reg.label + ' 공급 시차(12개월 착공·준공) vs 미분양' + (reg.supplyNote ? ' [' + reg.supplyNote + ']' : '');
    var svg = $('svg-supply');
    svg.innerHTML = '';
    var W = 960, H = 340, ML = 58, MR = 62, MT = 18, MB = 34;
    var pw = W - ML - MR, ph = H - MT - MB, n = rows.length;
    function X(i) { return ML + (n > 1 ? i / (n - 1) : 0.5) * pw; }

    var lVals = [], rVals = [];
    rows.forEach(function (r) {
      if (r.start12 != null) lVals.push(r.start12);
      if (r.done12 != null) lVals.push(r.done12);
      if (r.unsold != null) rVals.push(r.unsold);
    });
    if (!lVals.length && !rVals.length) {
      el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, svg).textContent = '해당 기간의 공급·미분양 자료가 없습니다.';
      return;
    }
    var RL = C.niceRange(0, Math.max.apply(null, lVals.length ? lVals : [1]), { clampZero: true });
    var RR = C.niceRange(0, Math.max.apply(null, rVals.length ? rVals : [1]), { clampZero: true });
    function YL(v) { return MT + (1 - (v - RL.min) / (RL.max - RL.min)) * ph; }
    function YR(v) { return MT + (1 - (v - RR.min) / (RR.max - RR.min)) * ph; }

    for (var k = 0; k <= 4; k++) {
      var y = MT + (k / 4) * ph;
      var lv = RL.max - (k / 4) * (RL.max - RL.min);
      var rv = RR.max - (k / 4) * (RR.max - RR.min);
      el('line', { x1: ML, x2: W - MR, y1: y, y2: y, 'class': k === 4 ? 'axis' : 'grid' }, svg);
      el('text', { x: ML - 8, y: y + 4, 'text-anchor': 'end' }, svg).textContent = fmtK(lv);
      el('text', { x: W - MR + 8, y: y + 4, 'text-anchor': 'start', style: 'fill:#dc2626' }, svg).textContent = fmtK(rv);
    }
    drawXTicks(svg, rows, X, H - 10);

    // 미분양 영역(Area)
    var pts = [];
    rows.forEach(function (r, i) { if (r.unsold != null) pts.push([X(i), YR(r.unsold)]); });
    if (pts.length) {
      var areaD = 'M' + pts[0][0].toFixed(1) + ',' + (H - MB) +
        pts.map(function (p) { return 'L' + p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join('') +
        'L' + pts[pts.length - 1][0].toFixed(1) + ',' + (H - MB) + 'Z';
      el('path', { d: areaD, fill: '#fca5a5', opacity: 0.45 }, svg);
      drawLinePath(svg, rows, 'unsold', X, YR, '#ef4444', 1.4, false);
    }

    drawLinePath(svg, rows, 'start12', X, YL, '#f59e0b', 2.5, false);
    drawLinePath(svg, rows, 'done12', X, YL, '#16a34a', 2.5, false);

    bindCrosshair(svg, rows, X, W, ML, MR, MT, H, MB, function (i) {
      var r = rows[i];
      $('info-supply').textContent = ymDot(r.m) +
        ' · 착공(12개월) ' + (r.start12 != null ? fmtNum(r.start12) + '호' : '-') +
        ' · 준공(12개월) ' + (r.done12 != null ? fmtNum(r.done12) + '호' : '-') +
        ' · 미분양 ' + (r.unsold != null ? fmtNum(r.unsold) + '호' : '-');
    });

    var lastSup = lastValid(rows, 'done12');
    var lastUn = lastValid(rows, 'unsold');
    $('note-supply').innerHTML = '<strong>해석 메모</strong>' +
      '주택은 착공 후 보통 2~3년 시차를 두고 준공(입주)으로 이어집니다. 주황선(착공 12개월 합계)의 급감·급증은 향후 입주 물량(초록선)의 선행 신호가 되며, ' +
      '최근 기준(' + (lastSup ? ymDot(lastSup.m) : '-') + ') ' + reg.label + (reg.supplyNote ? '(' + reg.supplyNote + ')' : '') +
      '의 최근 1년 착공은 ' + (lastSup && lastSup.start12 != null ? fmtNum(lastSup.start12) + '호' : '-') +
      ', 준공은 ' + (lastSup && lastSup.done12 != null ? fmtNum(lastSup.done12) + '호' : '-') +
      ', 미분양은 ' + (lastUn ? fmtNum(lastUn.unsold) + '호' : '-') + ' 수준입니다.';
  }

  function syncUrl() {
    C.setParams({ sido: state.region === '서울' ? null : state.region, y: state.years === 5 ? null : state.years });
  }

  function renderAll() {
    var reg = byKey[state.region] || byKey['서울'];
    var token = ++renderToken;
    C.setLoading('cmp-root', true, reg.label + ' 데이터를 결합하는 중입니다…');
    loadKbSeries(reg).then(function (kbSeries) {
      if (token !== renderToken) return;
      var allRows = buildAligned(reg, kbSeries);
      var rows = state.years ? allRows.slice(-state.years * 12) : allRows;
      renderSummary(reg, allRows);
      renderRateChart(reg, rows);
      renderRatioChart(reg, rows);
      renderSupplyChart(reg, rows);
      syncUrl();
      C.setLoading('cmp-root', false);
    }).catch(function (e) {
      console.error(e);
      C.setLoading('cmp-root', false);
      $('info-rate').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ')';
    });
  }

  function initUi() {
    var sel = $('sel-region');
    REGIONS.forEach(function (r) {
      var o = document.createElement('option');
      o.value = r.key;
      o.textContent = r.label;
      sel.appendChild(o);
    });

    // URL 쿼리(?sido=부산&y=10) 반영
    var params = C.getParams();
    if (params.sido) {
      var norm = C.normSido(params.sido);
      if (byKey[norm]) state.region = norm;
    }
    if (params.y !== undefined && !isNaN(+params.y)) {
      state.years = +params.y;
    }
    sel.value = state.region;
    document.querySelectorAll('#range [data-y]').forEach(function (b) {
      b.classList.toggle('on', +b.dataset.y === state.years);
    });

    sel.addEventListener('change', function (e) {
      state.region = e.target.value;
      renderAll();
    });
    C.bindSeg('range', 'y', function (v) {
      state.years = +v;
      renderAll();
    });
  }

  // 시작: 공통 JSON 5개 병렬 로드 (m_bundle.json 으로 1회 요청!)
  C.setLoading('cmp-root', true, '교차 분석 데이터를 불러오는 중입니다…');
  Promise.all([
    fetchJson('data/macro/rates.json'),
    fetchJson('data/macro/supply.json'),
    fetchJson('data/kb/index.json'),
    fetchJson('data/kb/aggregate.json'),
    fetchJson('data/trades/months.json'),
    fetchJson('data/trades/m_bundle.json').catch(function () { return {}; })
  ]).then(function (r) {
    ratesData = r[0];
    supplyData = r[1];
    kbIndex = r[2];
    kbAgg = r[3];
    tradeMonths = r[4].months || [];
    tradeBundle = r[5] || {};
    initUi();
    renderAll();
  }).catch(function (e) {
    console.error(e);
    C.setLoading('cmp-root', false);
    $('info-rate').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
  });
})();
