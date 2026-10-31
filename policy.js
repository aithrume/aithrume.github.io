/* =========================================================
   policy.js - 주요국 정책금리 (data/macro/policy.json, tools/build_policy.py 가 만듦)
   미국은 2008.12 부터 목표 범위: 상단 = 중간값 + 0.125, 하단 = 중간값 − 0.125
   ========================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  function $(id) { return document.getElementById(id); }
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  var D, byCode = {}, state = { on: {}, years: 10 };

  function ym(m) { return m.slice(0, 4) + '.' + m.slice(4); }
  function num(v) { return v.toFixed(2); }                            // 금리 표기 관례: 3.00, 3.75
  function isRange(i) { return D.months[i] >= D.usRangeFrom; }
  // 미국 i 번째 달의 [하단, 상단] (범위 이전이면 둘 다 목표 금리)
  function usBand(i) {
    var v = byCode.US.values[i];
    if (v == null) return null;
    return isRange(i) ? [v - 0.125, v + 0.125] : [v, v];
  }
  function fmtRate(code, i) {
    var v = byCode[code].values[i];
    if (v == null) return '-';
    if (code === 'US') { var b = usBand(i); return b[0] === b[1] ? num(b[0]) + '%' : num(b[0]) + '~' + num(b[1]) + '%'; }
    return num(v) + '%';
  }
  // 한미 금리차 = 한국 − 미국 상단
  function gap(i) {
    var k = byCode.KR.values[i], b = usBand(i);
    return k == null || !b ? null : k - b[1];
  }
  function chg(now, prev, label) {
    if (now == null || prev == null) return '<span class="muted">' + label + ' -</span>';
    var d = now - prev, a = d > 1e-9 ? '▲ ' : d < -1e-9 ? '▼ ' : '– ';
    return '<span class="' + (d > 1e-9 ? 'up' : d < -1e-9 ? 'down' : '') + '">' + label + ' ' + a + num(Math.abs(d)) + '%p</span>';
  }

  // ---------- 최신값 타일 ----------
  function renderSummary() {
    var i = D.months.length - 1;
    $('latest').textContent = ym(D.months[i]) + ' 말 기준';
    var tiles = ['US', 'KR', 'GAP', 'XM', 'JP', 'GB'].map(function (code) {
      if (code === 'GAP') {
        return '<div class="rate-tile" style="--tile-color:#6b7280"><span class="name">한미 금리차 (한국 − 미국 상단)</span>' +
          '<span class="num">' + (gap(i) > 0 ? '+' : '') + num(gap(i)) + '%p</span><span class="chg">' +
          chg(gap(i), gap(i - 1), '전월') + chg(gap(i), gap(i - 12), '1년 전') + '</span></div>';
      }
      var c = byCode[code], up = function (j) { return code === 'US' ? (usBand(j) || [])[1] : c.values[j]; };
      return '<div class="rate-tile" style="--tile-color:' + c.color + '"><span class="name">' + c.name + (code === 'US' ? ' (범위)' : '') + '</span>' +
        '<span class="num">' + fmtRate(code, i) + '</span><span class="chg">' +
        chg(up(i), up(i - 1), '전월') + chg(up(i), up(i - 12), '1년 전') + '</span></div>';
    });
    $('summary').innerHTML = tiles.join('');
  }

  // ---------- 나라 선택: 드롭다운 + 칩 ----------
  function renderPicker() {
    var box = $('picker');
    box.innerHTML =
      '<div class="rate-dd"><button type="button" class="rate-dd-btn" id="dd-btn" aria-expanded="false" aria-controls="dd-panel"></button>' +
      '<div class="rate-dd-panel" id="dd-panel" hidden><fieldset><legend>나라</legend>' +
      D.countries.map(function (c) {
        return '<label><input type="checkbox" value="' + c.code + '"' + (state.on[c.code] ? ' checked' : '') + '>' +
               '<i style="background:' + c.color + '"></i>' + c.name + '</label>';
      }).join('') +
      '</fieldset><div class="rate-dd-foot"><button type="button" data-act="default">기본값</button>' +
      '<button type="button" data-act="none">모두 해제</button><button type="button" data-act="close" class="primary">닫기</button></div></div></div>' +
      '<div class="rate-chips" id="chips"></div>';
    var btn = $('dd-btn'), panel = $('dd-panel');
    function open(v) { panel.hidden = !v; btn.setAttribute('aria-expanded', v); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(panel.hidden); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') open(false); });
    panel.addEventListener('change', function (e) { state.on[e.target.value] = e.target.checked; update(); });
    panel.querySelector('.rate-dd-foot').addEventListener('click', function (e) {
      var act = e.target.dataset.act;
      if (act === 'close') { open(false); return; }
      if (!act) return;
      state.on = {};
      if (act === 'default') D.default.forEach(function (c) { state.on[c] = true; });
      panel.querySelectorAll('input').forEach(function (c) { c.checked = !!state.on[c.value]; });
      update();
    });
    update();
  }
  function update() {
    var on = D.countries.filter(function (c) { return state.on[c.code]; });
    $('dd-btn').textContent = '나라 선택 (' + on.length + '/' + D.countries.length + ') ▾';
    var chips = $('chips');
    chips.innerHTML = '';
    on.forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'rate-chip'; b.title = c.name + ' 빼기';
      b.innerHTML = '<i style="background:' + c.color + '"></i>' + c.name + '<b>×</b>';
      b.addEventListener('click', function () {
        state.on[c.code] = false;
        var cb = document.querySelector('#dd-panel input[value="' + c.code + '"]');
        if (cb) cb.checked = false;
        update();
      });
      chips.appendChild(b);
    });
    renderCharts();
  }

  // ---------- 그래프 공통 ----------
  function niceTicks(min, max) {
    var range = max - min || 1, rough = range / 6;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var t = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(+v.toFixed(4));
    return t;
  }
  function xTicks(svg, start, end, X, y) {
    var n = end - start + 1, every = n > 180 ? 5 : n > 96 ? 2 : 1;
    for (var i = start; i <= end; i++) {
      var m = D.months[i];
      if (n <= 36 ? m.slice(4) === '01' || m.slice(4) === '07' : m.slice(4) === '01' && +m.slice(0, 4) % every === 0)
        el('text', { x: X(i), y: y, 'text-anchor': 'middle' }, svg).textContent = n <= 36 ? ym(m) : m.slice(0, 4);
    }
  }
  // 계단 모양 경로 (값 배열 → 'M x,y H x V y ...')
  function stepPath(vals, start, end, X, Y) {
    var d = '', pen = false;
    for (var i = start; i <= end; i++) {
      var v = vals(i);
      if (v == null) { pen = false; continue; }
      d += pen ? 'H' + X(i).toFixed(1) + 'V' + Y(v).toFixed(1) : 'M' + X(i).toFixed(1) + ',' + Y(v).toFixed(1);
      pen = true;
    }
    return d;
  }

  var W = 960, H = 420, ML = 52, MR = 160, MT = 16, MB = 34;
  function renderCharts() {
    var svg = $('kb-chart'), N = D.months.length;
    svg.innerHTML = '';
    var start = state.years ? Math.max(0, N - state.years * 12) : 0, end = N - 1;
    var on = D.countries.filter(function (c) { return state.on[c.code]; });
    var vals = [0];
    on.forEach(function (c) {
      for (var i = start; i <= end; i++) {
        if (c.values[i] == null) continue;
        if (c.code === 'US') vals.push(usBand(i)[0], usBand(i)[1]); else vals.push(c.values[i]);
      }
    });
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals), pad = (max - min) * 0.06 || 0.25;
    max += pad; min = min < 0 ? min - pad : 0;
    var pw = W - ML - MR;
    function X(i) { return ML + (i - start) / Math.max(1, end - start) * pw; }
    function Y(v) { return MT + (1 - (v - min) / (max - min)) * (H - MT - MB); }
    niceTicks(min, max).forEach(function (t) {
      el('line', { x1: ML, x2: W - MR, y1: Y(t), y2: Y(t), 'class': t === 0 ? 'axis' : 'grid' }, svg);
      el('text', { x: ML - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = t + '%';
    });
    xTicks(svg, start, end, X, H - 12);

    var labels = [];
    on.forEach(function (c) {
      if (c.code === 'US') {
        // 범위 띠: 상단을 따라 가고 하단을 거꾸로 돌아와 닫음
        var top = stepPath(function (i) { var b = usBand(i); return b && b[1]; }, start, end, X, Y);
        var pts = [];
        for (var i = start; i <= end; i++) { var b = usBand(i); if (b) pts.push([X(i), Y(b[0])]); }
        if (pts.length) {
          var last = pts.length - 1, bottom = 'L' + pts[last][0].toFixed(1) + ',' + pts[last][1].toFixed(1);
          for (var k = last; k > 0; k--) bottom += 'V' + pts[k - 1][1].toFixed(1) + 'H' + pts[k - 1][0].toFixed(1);
          el('path', { d: top + bottom + 'Z', fill: c.color, opacity: 0.22, stroke: 'none' }, svg);
        }
        el('path', { d: top, fill: 'none', stroke: c.color, 'stroke-width': 1.8 }, svg);
        el('path', { d: stepPath(function (i) { var b = usBand(i); return b && b[0]; }, start, end, X, Y), fill: 'none', stroke: c.color, 'stroke-width': 1.8 }, svg);
      } else {
        el('path', { d: stepPath(function (i) { return c.values[i]; }, start, end, X, Y), fill: 'none', stroke: c.color,
                     'stroke-width': c.code === 'KR' ? 2.6 : 2 }, svg);
      }
      var li = end;
      while (li >= start && c.values[li] == null) li--;
      if (li >= start) labels.push({ y: Y(c.code === 'US' ? usBand(li)[1] : c.values[li]), text: c.name + ' ' + fmtRate(c.code, li), color: c.color });
    });
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 15) labels[k].y = labels[k - 1].y + 15;
    labels.forEach(function (lb) {
      el('text', { x: W - MR + 8, y: lb.y + 4, style: 'font-size:12.5px;font-weight:700;fill:' + lb.color }, svg).textContent = lb.text;
    });

    var gapFn = renderGap(start, end);
    var cross = el('line', { y1: MT, y2: H - MB, stroke: '#6b7280', 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
    var hit = el('rect', { x: ML, y: MT, width: pw, height: H - MT - MB, fill: 'transparent' }, svg);
    function show(i) {
      $('hover-info').textContent = ym(D.months[i]) + ' · ' + on.map(function (c) { return c.name + ' ' + fmtRate(c.code, i); }).join(' · ');
      gapFn(i);
    }
    hit.addEventListener('pointermove', function (e) {
      var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
      var i = Math.max(start, Math.min(end, Math.round(start + (px - ML) / pw * (end - start))));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      show(i);
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); show(end); });
    show(end);
  }

  // ---------- 한미 금리차 (막대: 양수 파랑, 음수 빨강) ----------
  function renderGap(start, end) {
    var svg = $('gap-chart'), GW = 960, GH = 280, L = 52, R = 160, T = 14, B = 30;
    svg.innerHTML = '';
    var vals = [0];
    for (var i = start; i <= end; i++) if (gap(i) != null) vals.push(gap(i));
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals), pad = (max - min) * 0.1 || 0.25;
    max += pad; min -= pad;
    var pw = GW - L - R, n = end - start + 1, bw = Math.max(1, pw / n * 0.8);
    function X(i) { return L + (i - start + 0.5) / n * pw; }   // 막대마다 한 칸, 칸 가운데
    function Y(v) { return T + (1 - (v - min) / (max - min)) * (GH - T - B); }
    niceTicks(min, max).forEach(function (t) {
      el('line', { x1: L, x2: GW - R, y1: Y(t), y2: Y(t), 'class': t === 0 ? 'axis' : 'grid' }, svg);
      el('text', { x: L - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = (t > 0 ? '+' : '') + t + '%p';
    });
    xTicks(svg, start, end, X, GH - 8);
    for (i = start; i <= end; i++) {
      var g = gap(i);
      if (g == null || Math.abs(g) < 1e-9) continue;
      el('rect', { x: X(i) - bw / 2, y: Math.min(Y(0), Y(g)), width: bw, height: Math.abs(Y(g) - Y(0)), fill: g > 0 ? '#2563eb' : '#dc2626', opacity: 0.75 }, svg);
    }
    var last = gap(end);
    if (last != null) el('text', { x: GW - R + 8, y: Y(last) + 4, style: 'font-size:13px;font-weight:700;fill:' + (last >= 0 ? '#2563eb' : '#dc2626') }, svg)
      .textContent = (last > 0 ? '+' : '') + num(last) + '%p';
    var mark = el('line', { y1: T, y2: GH - B, stroke: '#6b7280', 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
    return function (i) {                           // 위 그래프에서 고른 달을 함께 표시
      mark.setAttribute('x1', X(i)); mark.setAttribute('x2', X(i)); mark.setAttribute('visibility', i === end ? 'hidden' : 'visible');
      var g = gap(i);
      $('gap-info').textContent = ym(D.months[i]) + ' · 한국 ' + fmtRate('KR', i) + ' − 미국 상단 ' + (usBand(i) ? num(usBand(i)[1]) + '%' : '-') +
        ' = ' + (g == null ? '-' : (g > 0 ? '+' : '') + num(g) + '%p') + (g != null ? (g < 0 ? ' (미국이 더 높음)' : g > 0 ? ' (한국이 더 높음)' : '') : '');
    };
  }

  function bindRange() {
    document.querySelectorAll('#range [data-y]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.years = +b.dataset.y;
        document.querySelectorAll('#range [data-y]').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderCharts();
      });
    });
  }

  fetch('data/macro/policy.json')
    .then(function (r) { if (!r.ok) throw new Error('data/macro/policy.json (' + r.status + ')'); return r.json(); })
    .then(function (d) {
      D = d;
      D.countries.forEach(function (c) { byCode[c.code] = c; });
      D.default.forEach(function (c) { state.on[c] = true; });
      renderSummary(); renderPicker(); bindRange();
    })
    .catch(function (e) {
      console.error(e);
      $('hover-info').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
    });
})();
