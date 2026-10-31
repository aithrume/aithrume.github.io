/* =========================================================
   rates.js - 주요 금리 월별 추이 (data/macro/rates.json, tools/build_rates.py 가 만듦)
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

  var SUMMARY = ['base', 'cd91', 'ktb3', 'ktb10', 'corpAA', 'mort'];               // 위쪽 최신값 타일
  var CURVE = [['ktb1', '1년'], ['ktb2', '2년'], ['ktb3', '3년'], ['ktb5', '5년'],
               ['ktb10', '10년'], ['ktb20', '20년'], ['ktb30', '30년']];             // 국고채 금리 곡선

  var D, byId = {}, state = { on: {}, years: 5, cur: 0 };

  function ym(m) { return m.slice(0, 4) + '.' + m.slice(4); }
  function pct(v) { return v == null ? '-' : v.toFixed(2) + '%'; }
  function chgHtml(now, prev, label) {                  // %p 변화
    if (now == null || prev == null) return '<span class="muted">' + label + ' -</span>';
    var d = now - prev, arrow = d > 0.0005 ? '▲ ' : d < -0.0005 ? '▼ ' : '– ';
    return '<span class="' + (d > 0.0005 ? 'up' : d < -0.0005 ? 'down' : '') + '">' + label + ' ' + arrow + Math.abs(d).toFixed(2) + '%p</span>';
  }
  function lastIdx(s) { for (var i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return i; return -1; }

  // ---------- 최신값 타일 ----------
  function renderSummary() {
    var last = D.months.length - 1;
    $('latest-month').textContent = ym(D.months[last]) + ' 기준';
    $('summary').innerHTML = SUMMARY.map(function (id) {
      var s = byId[id], i = lastIdx(s);
      return '<div class="rate-tile" style="--tile-color:' + s.color + '"><span class="name">' + s.name + '</span>' +
        '<span class="num">' + pct(s.values[i]) + '</span><span class="chg">' +
        chgHtml(s.values[i], s.values[i - 1], '전월') + chgHtml(s.values[i], s.values[i - 12], '1년 전') + '</span></div>';
    }).join('');
  }

  // ---------- 금리 고르기: 드롭다운(묶음별 체크박스) + 선택된 금리 칩 ----------
  function renderPicker() {
    var groups = [];
    D.series.forEach(function (s) { if (groups.indexOf(s.group) < 0) groups.push(s.group); });
    var box = $('picker');
    box.innerHTML =
      '<div class="rate-dd">' +
      '  <button type="button" class="rate-dd-btn" id="dd-btn" aria-expanded="false" aria-controls="dd-panel"></button>' +
      '  <div class="rate-dd-panel" id="dd-panel" hidden>' +
      groups.map(function (g) {
        return '<fieldset><legend>' + g + '</legend>' + D.series.filter(function (s) { return s.group === g; }).map(function (s) {
          return '<label><input type="checkbox" value="' + s.id + '"' + (state.on[s.id] ? ' checked' : '') + '>' +
                 '<i style="background:' + s.color + '"></i>' + s.name + '</label>';
        }).join('') + '</fieldset>';
      }).join('') +
      '    <div class="rate-dd-foot"><button type="button" data-act="default">기본값</button><button type="button" data-act="none">모두 해제</button>' +
      '    <button type="button" data-act="close" class="primary">닫기</button></div>' +
      '  </div>' +
      '</div>' +
      '<div class="rate-chips" id="chips"></div>';

    var btn = $('dd-btn'), panel = $('dd-panel');
    function open(v) { panel.hidden = !v; btn.setAttribute('aria-expanded', v); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(panel.hidden); });
    panel.addEventListener('click', function (e) { e.stopPropagation(); });
    document.addEventListener('click', function () { open(false); });          // 바깥을 누르면 닫힘
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') open(false); });
    panel.addEventListener('change', function (e) {
      state.on[e.target.value] = e.target.checked;
      update();
    });
    panel.querySelector('.rate-dd-foot').addEventListener('click', function (e) {
      var act = e.target.dataset.act;
      if (act === 'close') { open(false); return; }
      if (!act) return;
      state.on = {};
      if (act === 'default') D.default.forEach(function (id) { state.on[id] = true; });
      panel.querySelectorAll('input').forEach(function (c) { c.checked = !!state.on[c.value]; });
      update();
    });
    update();
  }
  // 버튼 글자·칩 갱신 후 그래프 다시 그리기
  function update() {
    var on = D.series.filter(function (s) { return state.on[s.id]; });
    $('dd-btn').textContent = '금리 선택 (' + on.length + '/' + D.series.length + ') ▾';
    var chips = $('chips');
    chips.innerHTML = '';
    on.forEach(function (s) {
      var c = document.createElement('button');
      c.type = 'button';
      c.className = 'rate-chip';
      c.title = s.name + ' 빼기';
      c.innerHTML = '<i style="background:' + s.color + '"></i>' + s.name + '<b>×</b>';
      c.addEventListener('click', function () {
        state.on[s.id] = false;
        var cb = document.querySelector('#dd-panel input[value="' + s.id + '"]');
        if (cb) cb.checked = false;
        update();
      });
      chips.appendChild(c);
    });
    renderChart();
  }

  // ---------- 추이 그래프 ----------
  var W = 960, H = 420, ML = 52, MR = 150, MT = 16, MB = 34;
  function niceTicks(min, max) {
    var range = max - min || 1, rough = range / 6;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var t = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(+v.toFixed(4));
    return t;
  }
  function renderChart() {
    var svg = $('kb-chart'), N = D.months.length;
    svg.innerHTML = '';
    var start = state.years ? Math.max(0, N - state.years * 12) : 0, end = N - 1, n = end - start + 1;
    var lines = D.series.filter(function (s) { return state.on[s.id]; });
    var vals = [];
    lines.forEach(function (s) { for (var i = start; i <= end; i++) if (s.values[i] != null) vals.push(s.values[i]); });
    if (!vals.length) {
      el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', style: 'font-size:18px' }, svg).textContent = '위에서 금리를 하나 이상 골라 주세요';
      $('hover-info').textContent = '';
      return;
    }
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), pad = (max - min) * 0.08 || 0.25;
    min = Math.max(0, min - pad); max += pad;
    var pw = W - ML - MR;
    function X(i) { return ML + (n > 1 ? (i - start) / (n - 1) : 0.5) * pw; }
    function Y(v) { return MT + (1 - (v - min) / (max - min)) * (H - MT - MB); }

    niceTicks(min, max).forEach(function (t) {
      el('line', { x1: ML, x2: W - MR, y1: Y(t), y2: Y(t), 'class': 'grid' }, svg);
      el('text', { x: ML - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = t + '%';
    });
    // 가로 눈금: 기간이 길면 몇 년마다
    var every = n > 180 ? 5 : n > 96 ? 2 : 1;
    for (var i = start; i <= end; i++) {
      var m = D.months[i];
      if (n <= 24 ? (m.slice(4) === '01' || m.slice(4) === '07') : (m.slice(4) === '01' && +m.slice(0, 4) % every === 0)) {
        el('line', { x1: X(i), x2: X(i), y1: H - MB, y2: H - MB + 5, 'class': 'axis' }, svg);
        el('text', { x: X(i), y: H - 12, 'text-anchor': 'middle' }, svg).textContent = n <= 24 ? ym(m) : m.slice(0, 4);
      }
    }
    el('line', { x1: ML, x2: W - MR, y1: H - MB, y2: H - MB, 'class': 'axis' }, svg);

    var labels = [];
    lines.forEach(function (s) {
      var d = '', pen = false, last = -1, prevY = null;
      for (var i = start; i <= end; i++) {
        var v = s.values[i];
        if (v == null) { pen = false; continue; }
        var x = X(i).toFixed(1), y = Y(v).toFixed(1);
        if (s.id === 'base' && pen) d += 'H' + x + 'V' + y;      // 기준금리는 계단 모양
        else d += (pen ? 'L' : 'M') + x + ',' + y;
        pen = true; last = i; prevY = y;
      }
      el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': s.id === 'base' ? 2.8 : 2, 'stroke-linejoin': 'round' }, svg);
      if (last >= 0) labels.push({ y: Y(s.values[last]), text: s.name + ' ' + pct(s.values[last]), color: s.color });
    });
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 15) labels[k].y = labels[k - 1].y + 15;
    labels.forEach(function (lb) {
      el('text', { x: W - MR + 8, y: lb.y + 4, style: 'font-size:12.5px;font-weight:700;fill:' + lb.color }, svg).textContent = lb.text;
    });

    // 마우스: 세로선 + 그 달 값, 금리 곡선도 그 달로
    var cross = el('line', { y1: MT, y2: H - MB, stroke: '#6b7280', 'stroke-dasharray': '3 3', visibility: 'hidden' }, svg);
    var hit = el('rect', { x: ML, y: MT, width: pw, height: H - MT - MB, fill: 'transparent' }, svg);
    function idxOf(e) {
      var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width);
      return Math.max(start, Math.min(end, Math.round(start + (px - ML) / pw * (n - 1))));
    }
    function show(i) {
      var parts = lines.map(function (s) { return s.name + ' ' + pct(s.values[i]); });
      $('hover-info').textContent = ym(D.months[i]) + ' · ' + parts.join(' · ');
      renderCurve(i);
    }
    hit.addEventListener('pointermove', function (e) {
      var i = idxOf(e);
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      show(i);
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); show(end); });
    show(end);
  }

  // ---------- 국고채 금리 곡선 ----------
  function renderCurve(i) {
    var svg = $('curve-chart'), CW = 960, CH = 340, L = 52, R = 40, T = 22, B = 70;   // 아래: 만기 글자 + 범례
    svg.innerHTML = '';
    var j = i - 12;
    var now = CURVE.map(function (c) { return byId[c[0]].values[i]; });
    var ago = CURVE.map(function (c) { return j >= 0 ? byId[c[0]].values[j] : null; });
    var all = now.concat(ago).filter(function (v) { return v != null; });
    $('curve-title').textContent = '국고채 금리 곡선 (' + ym(D.months[i]) + ')';
    if (!all.length) return;
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all), pad = (max - min) * 0.15 || 0.2;
    min = Math.max(0, min - pad); max += pad;
    function X(k) { return L + k / (CURVE.length - 1) * (CW - L - R); }
    function Y(v) { return T + (1 - (v - min) / (max - min)) * (CH - T - B); }
    niceTicks(min, max).forEach(function (t) {
      el('line', { x1: L, x2: CW - R, y1: Y(t), y2: Y(t), 'class': 'grid' }, svg);
      el('text', { x: L - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = t + '%';
    });
    CURVE.forEach(function (c, k) { el('text', { x: X(k), y: CH - B + 22, 'text-anchor': 'middle' }, svg).textContent = c[1]; });
    function line(data, color, dash, label) {
      var d = '', pen = false;
      data.forEach(function (v, k) {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(v).toFixed(1); pen = true;
      });
      var a = { d: d, fill: 'none', stroke: color, 'stroke-width': dash ? 1.8 : 2.6 };
      if (dash) a['stroke-dasharray'] = dash;
      el('path', a, svg);
      data.forEach(function (v, k) {
        if (v == null) return;
        el('circle', { cx: X(k), cy: Y(v), r: dash ? 3 : 4, fill: color }, svg);
        if (!dash) el('text', { x: X(k), y: Y(v) - 9, 'text-anchor': 'middle', style: 'font-size:12px;font-weight:700;fill:' + color }, svg).textContent = v.toFixed(2);
      });
      var lastK = -1;
      data.forEach(function (v, k) { if (v != null) lastK = k; });
      if (label && lastK >= 0) el('text', { x: dash ? CW - R - 150 : CW - R, y: CH - 8, 'text-anchor': 'end', style: 'font-size:13px;font-weight:700;fill:' + color }, svg).textContent = label;
    }
    if (j >= 0) line(ago, '#9ca3af', '5 4', '- - ' + ym(D.months[j]) + ' (1년 전)');
    line(now, '#2563eb', null, '── ' + ym(D.months[i]));
  }

  // ---------- 시작 ----------
  function bindRange() {
    document.querySelectorAll('#range [data-y]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.years = +b.dataset.y;
        document.querySelectorAll('#range [data-y]').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderChart();
      });
    });
  }

  fetch('data/macro/rates.json')
    .then(function (r) { if (!r.ok) throw new Error('data/macro/rates.json (' + r.status + ')'); return r.json(); })
    .then(function (d) {
      D = d;
      D.series.forEach(function (s) { byId[s.id] = s; });
      D.default.forEach(function (id) { state.on[id] = true; });
      renderSummary(); renderPicker(); bindRange();
    })
    .catch(function (e) {
      console.error(e);
      $('hover-info').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
    });
})();
