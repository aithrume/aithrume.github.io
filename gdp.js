/* =========================================================
   gdp.js - GDP 성장률 (data/macro/gdp.json, tools/build_gdp.py 가 만듦)
   ========================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var COLOR = { real: '#2563eb', nominal: '#f59e0b' };
  function $(id) { return document.getElementById(id); }
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function pct(v) { return v == null ? '-' : (v > 0 ? '+' : '') + v.toFixed(1) + '%'; }
  function qLabel(p) { return p.slice(0, 4) + '년 ' + p.slice(5) + '분기'; }   // '2026Q3' → '2026년 3분기'

  var D, state = { qYears: 5, qMode: 'QoQ', aYears: 20 };
  function series(group, id) { return D[group].series.filter(function (s) { return s.id === id; })[0]; }
  function lastIdx(values) { for (var i = values.length - 1; i >= 0; i--) if (values[i] != null) return i; return -1; }

  // ---------- 최신값 타일 ----------
  function renderSummary() {
    var tiles = [
      ['quarter', 'realQoQ', '실질 · 전기 대비', COLOR.real],
      ['quarter', 'realYoY', '실질 · 전년 동기 대비', COLOR.real],
      ['quarter', 'nominalQoQ', '명목 · 전기 대비', COLOR.nominal],
      ['quarter', 'nominalYoY', '명목 · 전년 동기 대비', COLOR.nominal],
      ['annual', 'real', '실질 · 연간', COLOR.real],
      ['annual', 'nominal', '명목 · 연간', COLOR.nominal]
    ];
    $('summary').innerHTML = tiles.map(function (t) {
      var s = series(t[0], t[1]), i = lastIdx(s.values), p = D[t[0]].periods[i];
      return '<div class="rate-tile" style="--tile-color:' + t[3] + '"><span class="name">' + t[2] + '</span>' +
        '<span class="num">' + pct(s.values[i]) + '</span><span class="chg"><span class="muted">' +
        (t[0] === 'quarter' ? qLabel(p) : p + '년') + '</span></span></div>';
    }).join('');
    var q = D.quarter.periods[lastIdx(series('quarter', 'realQoQ').values)];
    $('latest').textContent = '최근 분기 ' + qLabel(q) + ' · 갱신 ' + D.updated;
  }

  // ---------- 막대그래프 (실질·명목 나란히) ----------
  var W = 960, H = 380, ML = 50, MR = 20, MT = 16, MB = 34;
  function niceTicks(min, max) {
    var range = max - min || 1, rough = range / 6;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var t = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(+v.toFixed(4));
    return t;
  }
  // opt: { svg, info, periods, real, nominal, start, label(p), tick(p, k, n) }
  function renderBars(opt) {
    var svg = opt.svg;
    svg.innerHTML = '';
    var idx = [];
    for (var i = opt.start; i < opt.periods.length; i++) idx.push(i);
    var vals = [0];
    idx.forEach(function (i) { [opt.real[i], opt.nominal[i]].forEach(function (v) { if (v != null) vals.push(v); }); });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), pad = (max - min) * 0.08 || 1;
    min = min < 0 ? min - pad : 0; max += pad;
    var pw = W - ML - MR, n = idx.length, slot = pw / n, bw = Math.max(1, Math.min(18, slot * 0.38));
    function X(k) { return ML + (k + 0.5) * slot; }
    function Y(v) { return MT + (1 - (v - min) / (max - min)) * (H - MT - MB); }

    niceTicks(min, max).forEach(function (t) {
      el('line', { x1: ML, x2: W - MR, y1: Y(t), y2: Y(t), 'class': t === 0 ? 'axis' : 'grid' }, svg);
      el('text', { x: ML - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = t + '%';
    });
    var band = el('rect', { y: MT, width: slot, height: H - MT - MB, fill: '#2563eb', opacity: 0, rx: 3 }, svg);
    idx.forEach(function (i, k) {
      [['real', -1], ['nominal', 1]].forEach(function (s) {
        var v = opt[s[0]][i];
        if (v == null) return;
        var y0 = Y(0), y1 = Y(v);
        el('rect', { x: X(k) + (s[1] < 0 ? -bw : 0), y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)),
                     fill: COLOR[s[0]], rx: 1.5 }, svg);
      });
      var tick = opt.tick(opt.periods[i], k, n);
      if (tick) el('text', { x: X(k), y: H - 12, 'text-anchor': 'middle' }, svg).textContent = tick;
    });

    // 마우스를 올리면 그 시점 값
    var hit = el('rect', { x: ML, y: MT, width: pw, height: H - MT - MB, fill: 'transparent' }, svg);
    function show(k) {
      var i = idx[k];
      band.setAttribute('x', ML + k * slot); band.setAttribute('opacity', 0.08);
      opt.info.textContent = opt.label(opt.periods[i]) + ' · 실질 ' + pct(opt.real[i]) + ' · 명목 ' + pct(opt.nominal[i]);
    }
    hit.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
      show(Math.max(0, Math.min(n - 1, Math.floor((px - ML) / slot))));
    });
    hit.addEventListener('pointerleave', function () { show(n - 1); });
    show(n - 1);
  }

  function renderQuarter() {
    var Q = D.quarter, n = Q.periods.length;
    var start = state.qYears ? Math.max(0, n - state.qYears * 4) : 0, span = n - start;
    renderBars({
      svg: $('q-chart'), info: $('q-info'), periods: Q.periods, start: start,
      real: series('quarter', 'real' + state.qMode).values, nominal: series('quarter', 'nominal' + state.qMode).values,
      label: qLabel,
      tick: function (p) {                                 // 기간이 길면 몇 년마다 1분기에만 연도 표시
        var every = span > 60 ? 4 : span > 24 ? 2 : 1;
        if (span <= 16) return p.slice(2, 4) + '.' + p.slice(5) + 'Q';
        return p.slice(5) === '1' && +p.slice(0, 4) % every === 0 ? p.slice(0, 4) : '';
      }
    });
  }
  function renderAnnual() {
    var A = D.annual, n = A.periods.length;
    var start = state.aYears ? Math.max(0, n - state.aYears) : 0, span = n - start;
    renderBars({
      svg: $('a-chart'), info: $('a-info'), periods: A.periods, start: start,
      real: series('annual', 'real').values, nominal: series('annual', 'nominal').values,
      label: function (p) { return p + '년'; },
      tick: function (p) { var every = span > 30 ? 5 : span > 12 ? 2 : 1; return +p % every === 0 ? p : ''; }
    });
  }

  function bindSeg(id, attr, fn) {
    document.querySelectorAll('#' + id + ' [data-' + attr + ']').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#' + id + ' [data-' + attr + ']').forEach(function (x) { x.classList.toggle('on', x === b); });
        fn(b.dataset[attr]);
      });
    });
  }

  fetch('data/macro/gdp.json')
    .then(function (r) { if (!r.ok) throw new Error('data/macro/gdp.json (' + r.status + ')'); return r.json(); })
    .then(function (d) {
      D = d;
      renderSummary(); renderQuarter(); renderAnnual();
      bindSeg('q-range', 'y', function (v) { state.qYears = +v; renderQuarter(); });
      bindSeg('q-mode', 'mode', function (v) { state.qMode = v; renderQuarter(); });
      bindSeg('a-range', 'y', function (v) { state.aYears = +v; renderAnnual(); });
    })
    .catch(function (e) {
      console.error(e);
      $('q-info').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
    });
})();
