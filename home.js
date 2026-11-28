/* =========================================================
   home.js - 메인 페이지(index.html) 최신 KPI 스냅샷(B안) 및
             교차 분석 배너 미니 그래프(옵션 2) 렌더링
   데이터: data/summary.json (tools/build_summary.py 가 생성)
   ========================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function renderKpis(cards) {
    document.querySelectorAll('[data-kpi]').forEach(function (card) {
      var k = card.getAttribute('data-kpi');
      var info = cards && cards[k];
      if (!info) return;
      var dateEl = card.querySelector('.card-date');
      if (dateEl && info.date) dateEl.textContent = info.date;

      var box = card.querySelector('.kpi-box');
      if (!box) return;
      var toneClass = info.tone === 'up' ? ' up' : info.tone === 'down' ? ' down' : '';
      box.innerHTML =
        '<div class="kpi-top">' +
        '  <span class="kpi-label"></span>' +
        '  <span class="kpi-val' + toneClass + '"></span>' +
        '</div>' +
        (info.sub ? '<div class="kpi-sub"></div>' : '');
      box.querySelector('.kpi-label').textContent = info.label || '';
      box.querySelector('.kpi-val').textContent = info.value || '-';
      if (info.sub) box.querySelector('.kpi-sub').textContent = info.sub;
      box.hidden = false;
    });
  }

  function renderMiniChart(preview) {
    var svg = document.getElementById('cross-mini-svg');
    if (!svg || !preview || preview.length < 2) return;
    svg.innerHTML = '';

    var W = 260, H = 90, ML = 10, MR = 10, MT = 22, MB = 16;
    var pw = W - ML - MR, ph = H - MT - MB;
    var n = preview.length;
    var kbVals = preview.map(function (r) { return r[1]; });
    var rVals = preview.map(function (r) { return r[2]; });
    var kMin = Math.min.apply(null, kbVals) - 1, kMax = Math.max.apply(null, kbVals) + 1;
    var rMin = Math.min.apply(null, rVals) - 0.2, rMax = Math.max.apply(null, rVals) + 0.2;

    function X(i) { return ML + (i / (n - 1)) * pw; }
    function YK(v) { return MT + (1 - (v - kMin) / (kMax - kMin)) * ph; }
    function YR(v) { return MT + (1 - (v - rMin) / (rMax - rMin)) * ph; }

    [0, 0.5, 1].forEach(function (t) {
      var y = MT + t * ph;
      el('line', { x1: ML, x2: W - MR, y1: y, y2: y, stroke: t === 1 ? '#cbd5e1' : '#eef0f3', 'stroke-width': 1 }, svg);
    });

    var dK = preview.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + YK(r[1]).toFixed(1); }).join('');
    var dR = preview.map(function (r, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + YR(r[2]).toFixed(1); }).join('');
    el('path', { d: dK, fill: 'none', stroke: '#2563eb', 'stroke-width': 2.4, 'stroke-linejoin': 'round' }, svg);
    el('path', { d: dR, fill: 'none', stroke: '#dc2626', 'stroke-width': 2, 'stroke-linejoin': 'round' }, svg);

    el('text', { x: ML, y: 14, style: 'font-size:10px;font-weight:700;fill:#2563eb' }, svg).textContent = '서울 KB매매';
    el('text', { x: W - MR, y: 14, 'text-anchor': 'end', style: 'font-size:10px;font-weight:700;fill:#dc2626' }, svg).textContent = '주담대 금리';
    el('text', { x: ML, y: H - 3, style: 'font-size:9px;fill:#94a3b8' }, svg).textContent = preview[0][0].slice(0, 4) + '.' + preview[0][0].slice(4);
    el('text', { x: W - MR, y: H - 3, 'text-anchor': 'end', style: 'font-size:9px;fill:#94a3b8' }, svg).textContent = preview[n - 1][0].slice(0, 4) + '.' + preview[n - 1][0].slice(4);
  }

  fetch('data/summary.json')
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      renderKpis(d.cards);
      renderMiniChart(d.preview);
    })
    .catch(function (err) {
      console.warn('summary.json 불러오기 생략:', err);
    });
})();
