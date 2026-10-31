/* =========================================================
   supply.js - 주택 공급·미분양 (data/macro/supply.json, tools/build_supply.py 가 만듦)
     regions : 전국·수도권·지방(level 0) / 시도(level 1, geo = 경계 코드들) / 시군구(level 2, shapes = 경계 코드들)
     data    : 지역 → { unsold: 미분양[], after: 준공 후 미분양[], start: 착공[], done: 준공[] } (월 순서)
   ========================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  function $(id) { return document.getElementById(id); }

  var LON0 = 124.5, LAT1 = 38.7, KY = 100, KX = 100 * Math.cos(36 * Math.PI / 180);
  var FULL_VIEW = [0, 0, 607, 570];
  var HIDE_SHAPES = { '23320': '옹진군' };     // 시도 확대 지도에서 그리지 않는 경계(멀리 떨어진 섬)
  var SEQ_LO = [254, 242, 242], SEQ_HI = [185, 28, 28];
  var NAME = { unsold: '미분양', after: '준공 후 미분양', start: '착공', done: '준공' };
  var COLOR = { unsold: '#2563eb', after: '#dc2626', start: '#f59e0b', done: '#16a34a' };

  var state = { metric: 'unsold', m: 0, sidoId: null, regionId: '전국', years: 10, flow: 'sum12' };
  var D, regions = {}, sidos = [], geoSido, geoSgg;
  var sidoPaths = {}, sggPaths = [], sggByCode = {};
  var gS, gG, gL, curView = FULL_VIEW.slice(), targetView = FULL_VIEW.slice(), viewAnim = 0;

  // ---------- 도구 ----------
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fetchJson(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url + ' (' + r.status + ')'); return r.json(); });
  }
  function lerp(a, b, t) { return a.map(function (x, i) { return Math.round(x + (b[i] - x) * t); }); }
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }
  function fmtNum(n) { return n == null ? '-' : Math.round(n).toLocaleString('ko-KR'); }
  function ym(m) { return m.slice(0, 4) + '.' + m.slice(4); }
  function ymLabel(m) { return m.slice(0, 4) + '년 ' + (+m.slice(4)) + '월'; }
  function val(rid, key, i) { var s = D.data[rid]; return s && s[key] ? s[key][i] : null; }
  // 착공·준공 그래프 값: 월별 또는 최근 12개월 합계(12달이 다 있어야 계산)
  function flowVal(rid, key, i) {
    if (state.flow === 'month') return val(rid, key, i);
    if (i < 11) return null;
    var s = 0;
    for (var j = i - 11; j <= i; j++) { var v = val(rid, key, j); if (v == null) return null; s += v; }
    return s;
  }
  // 착공·준공은 시도까지만 있어서 시군구는 그 시도 값
  function flowRegion(rid) { var r = regions[rid]; return r.level === 2 ? r.sido : rid; }
  function displayName(r) { return r.level === 2 ? regions[r.sido].name + ' ' + r.name : r.name; }
  function niceRange(min, max) {
    var range = max - min || 1, rough = range / 5;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var lo = Math.floor(min / step - 1e-9) * step, hi = Math.ceil(max / step + 1e-9) * step, t = [];
    if (hi - max < step * 0.15) hi += step;
    for (var v = Math.max(0, lo); v <= hi + 1e-9; v += step) t.push(+v.toFixed(4));
    return { min: Math.max(0, lo), max: hi, ticks: t };
  }
  function fmtAxis(v) { return v >= 10000 ? (v / 10000) + '만' : fmtNum(v); }

  // ---------- 지도 ----------
  function proj(p) { return ((p[0] - LON0) * KX).toFixed(1) + ',' + ((LAT1 - p[1]) * KY).toFixed(1); }
  function pathD(geom) {
    var d = '';
    geom.coordinates.forEach(function (poly) { poly.forEach(function (ring) { d += 'M' + ring.map(proj).join('L') + 'Z'; }); });
    return d;
  }
  function bboxOf(features) {
    var polys = [];
    features.forEach(function (f) {
      f.geometry.coordinates.forEach(function (poly) {
        var b = [1e9, 1e9, -1e9, -1e9];
        poly[0].forEach(function (p) {
          var x = (p[0] - LON0) * KX, y = (LAT1 - p[1]) * KY;
          b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
        });
        polys.push({ b: b, a: (b[2] - b[0]) * (b[3] - b[1]) });
      });
    });
    var maxA = Math.max.apply(null, polys.map(function (p) { return p.a; })), out = [1e9, 1e9, -1e9, -1e9];
    polys.forEach(function (p) {
      if (p.a < maxA * 0.05) return;
      out[0] = Math.min(out[0], p.b[0]); out[1] = Math.min(out[1], p.b[1]); out[2] = Math.max(out[2], p.b[2]); out[3] = Math.max(out[3], p.b[3]);
    });
    return out;
  }
  function setView(v) { $('kb-map').setAttribute('viewBox', v.map(function (n) { return n.toFixed(1); }).join(' ')); curView = v; }
  function animateView(to) {
    var from = curView.slice(), t0 = null, id = ++viewAnim;
    targetView = to.slice();
    function step(ts) {
      if (id !== viewAnim) return;
      if (t0 === null) t0 = ts;
      var t = Math.min(1, (ts - t0) / 350), e = 1 - Math.pow(1 - t, 3);
      setView(from.map(function (f, i) { return f + (to[i] - f) * e; }));
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  function viewForBox(b) { var w = b[2] - b[0], h = b[3] - b[1], pad = Math.max(w, h) * 0.08; return [b[0] - pad, b[1] - pad, w + pad * 2, h + pad * 2]; }

  function showTip(e, html) {
    var tip = $('map-tip'), box = tip.parentNode.getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false;
    var x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 10;
    if (y + tip.offsetHeight > box.height) y = e.clientY - box.top - tip.offsetHeight - 10;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  }
  function tipHtml(rid, name) {
    if (!rid) return '<strong>' + name + '</strong><br>자료 없음';
    var i = state.m;
    return '<strong>' + displayName(regions[rid]) + '</strong><br>미분양 ' + fmtNum(val(rid, 'unsold', i)) + '호<br>준공 후 미분양 ' + fmtNum(val(rid, 'after', i)) + '호';
  }
  function bindShape(path, rid, name, onClick) {
    path.addEventListener('pointermove', function (e) { showTip(e, tipHtml(rid, name)); });
    path.addEventListener('pointerleave', function () { $('map-tip').hidden = true; });
    path.addEventListener('click', onClick);
  }

  function initMap() {
    var svg = $('kb-map');
    gS = el('g', {}, svg); gG = el('g', {}, svg); gL = el('g', { 'class': 'map-labels' }, svg);
    var byGeo = {};
    sidos.forEach(function (r) { r.geo.forEach(function (g) { byGeo[g] = r.id; }); });
    geoSido.features.forEach(function (f) {
      var rid = byGeo[f.properties.code] || null;
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gS);
      p.dataset.rid = rid || ''; p.feature = f;
      sidoPaths[f.properties.code] = p;
      bindShape(p, rid, f.properties.name, function () { if (rid) onSidoClick(rid); });
    });
  }
  function buildSggLayer(sidoId) {
    while (gG.firstChild) gG.removeChild(gG.firstChild);
    sggPaths = []; sggByCode = {};
    var s = regions[sidoId], codeMap = {}, owned = {};
    D.regions.forEach(function (r) { if (r.level === 2) r.shapes.forEach(function (c) { owned[c] = r.sido; codeMap[c] = r.id; }); });
    geoSgg.features.forEach(function (f) {
      var code = f.properties.code, rid = codeMap[code] || null;
      if (HIDE_SHAPES[code]) return;
      if (rid ? owned[code] !== sidoId : s.geo.indexOf(code.slice(0, 2)) < 0) return;
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gG);
      p.dataset.rid = rid || ''; p.feature = f;
      if (!rid) p.classList.add('nodata');
      bindShape(p, rid, f.properties.name, function () { if (rid) selectRegion(rid); });
      sggPaths.push(p); sggByCode[code] = p;
    });
  }
  function currentPaths() { return state.sidoId == null ? Object.keys(sidoPaths).map(function (c) { return sidoPaths[c]; }) : sggPaths; }
  function recolor() {
    var paths = currentPaths(), rids = [], nums = [];
    paths.forEach(function (p) { var r = p.dataset.rid; if (r && rids.indexOf(r) < 0) rids.push(r); });
    rids.forEach(function (r) { var v = val(r, state.metric, state.m); if (v != null) nums.push(v); });
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    paths.forEach(function (p) {
      var v = p.dataset.rid ? val(p.dataset.rid, state.metric, state.m) : null;
      if (v == null) { p.setAttribute('fill', '#e5e7eb'); return; }
      var t = !v ? 0 : sorted.length > 1 ? sorted.indexOf(v) / (sorted.length - 1) : 0.5;     // 0호는 가장 연하게
      p.setAttribute('fill', v ? rgb(lerp(SEQ_LO, SEQ_HI, 0.15 + 0.85 * t)) : '#f8fafc');
    });
    $('lg-min').textContent = sorted.length ? '적음 ' + fmtNum(sorted[0]) + '호' : '적음';
    $('lg-max').textContent = sorted.length ? '많음 ' + fmtNum(sorted[sorted.length - 1]) + '호' : '많음';
    var byKey = {}, nat = state.sidoId == null;                // 지역명
    paths.forEach(function (p) {
      var rid = p.dataset.rid, code = p.feature.properties.code, has = rid && val(rid, state.metric, state.m);
      var key = nat ? 'g:' + code : rid || 'g:' + code;
      var text = nat ? MapLabels.SIDO_SHORT[code] : rid ? regions[rid].name : p.feature.properties.name.replace(/^.+시(.+구)$/, '$1');
      (byKey[key] = byKey[key] || { text: text, features: [], priority: has ? (nat ? MapLabels.sidoPriority(code) : 0) : -1 }).features.push(p.feature);
    });
    MapLabels.draw(gL, Object.keys(byKey).map(function (k) { return byKey[k]; }), targetView);
  }
  function shapesFor(rid) {
    var r = regions[rid], out = [];
    if (!r || r.level === 0) return out;
    if (r.level === 1) { if (state.sidoId == null) r.geo.forEach(function (g) { if (sidoPaths[g]) out.push(sidoPaths[g]); }); return out; }
    r.shapes.forEach(function (c) { if (sggByCode[c]) out.push(sggByCode[c]); });
    return out;
  }
  function highlight() {
    Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.remove('sel'); });
    sggPaths.forEach(function (p) { p.classList.remove('sel'); });
    shapesFor(state.regionId).forEach(function (p) { p.classList.add('sel'); });
  }

  // ---------- 선택 ----------
  function onSidoClick(rid) { if (state.sidoId !== rid) selectSido(rid); selectRegion(rid); }
  function selectSido(sidoId) {
    var s = sidoId ? regions[sidoId] : null;
    if (!s || s.level !== 1) {
      state.sidoId = null;
      while (gG.firstChild) gG.removeChild(gG.firstChild);
      sggPaths = []; sggByCode = {};
      Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.remove('dim'); });
      animateView(FULL_VIEW);
    } else {
      state.sidoId = sidoId;
      buildSggLayer(sidoId);
      Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.toggle('dim', sidoPaths[c].dataset.rid !== sidoId); });
      animateView(viewForBox(bboxOf(sggPaths.map(function (p) { return p.feature; }))));
    }
    fillSggSelect(); updateTitles(); recolor(); highlight(); renderRank();
    $('btn-back').hidden = state.sidoId == null;
  }
  function selectRegion(rid) {
    state.regionId = rid;
    syncSelects(); highlight(); renderRank(); renderStats(); renderCharts();
  }
  function setMonth(i) {
    state.m = Math.max(0, Math.min(D.months.length - 1, i));
    $('month').value = state.m;
    $('month-label').textContent = ym(D.months[state.m]);
    updateTitles(); recolor(); renderRank(); renderStats(); renderCharts();
  }

  // ---------- 선택 상자·제목·순위 ----------
  function fillSidoSelect() {
    var h = '<optgroup label="전국·권역">';
    D.regions.forEach(function (r) { if (r.level === 0) h += '<option value="' + r.id + '">' + r.name + '</option>'; });
    h += '</optgroup><optgroup label="시도">';
    sidos.forEach(function (r) { h += '<option value="' + r.id + '">' + r.name + '</option>'; });
    $('sel-sido').innerHTML = h + '</optgroup>';
  }
  function fillSggSelect() {
    var sel = $('sel-sgg');
    if (!state.sidoId) { sel.innerHTML = '<option value="">시도를 먼저 선택</option>'; sel.disabled = true; return; }
    var h = '<option value="">(시도 전체)</option>';
    D.regions.forEach(function (r) { if (r.level === 2 && r.sido === state.sidoId) h += '<option value="' + r.id + '">' + r.name + '</option>'; });
    sel.innerHTML = h; sel.disabled = false;
  }
  function syncSelects() {
    var r = regions[state.regionId];
    $('sel-sido').value = r.level === 2 ? r.sido : r.id;
    $('sel-sgg').value = r.level === 2 ? r.id : '';
  }
  function updateTitles() {
    var area = state.sidoId ? regions[state.sidoId].name + ' 시군구별' : '전국 시도별';
    $('map-title').textContent = area + ' ' + NAME[state.metric] + ' (' + ymLabel(D.months[state.m]) + ')';
    $('rank-title').textContent = (state.sidoId ? '시군구별' : '시도별') + ' ' + NAME[state.metric] + ' 순위';
  }
  function renderRank() {
    var ids = state.sidoId == null ? sidos.map(function (r) { return r.id; })
      : D.regions.filter(function (r) { return r.level === 2 && r.sido === state.sidoId; }).map(function (r) { return r.id; });
    var rows = ids.map(function (id) { return { id: id, v: val(id, state.metric, state.m) }; });
    rows.sort(function (a, b) { return a.v == null ? 1 : b.v == null ? -1 : b.v - a.v; });
    var max = Math.max.apply(null, rows.map(function (x) { return x.v || 0; }).concat([1]));
    var ol = $('rank'); ol.innerHTML = '';
    rows.forEach(function (it) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      if (it.id === state.regionId) b.className = 'on';
      b.innerHTML = '<span>' + regions[it.id].name + '</span><span class="bar left">' +
        (it.v ? '<i style="left:0;background:' + rgb(SEQ_HI) + ';width:' + (it.v / max * 100) + '%"></i>' : '') +
        '</span><span class="num">' + fmtNum(it.v) + '</span>';
      b.addEventListener('click', function () { if (state.sidoId == null) onSidoClick(it.id); else selectRegion(it.id); });
      li.appendChild(b); ol.appendChild(li);
    });
  }

  // ---------- 숫자 카드 ----------
  function chgSpan(label, now, prev) {
    if (now == null || prev == null || !prev) return '<span class="muted">' + label + ' -</span>';
    var d = (now - prev) / prev * 100, a = d > 0 ? '▲ ' : d < 0 ? '▼ ' : '– ';
    return '<span class="' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + label + ' ' + a + Math.abs(d).toFixed(1) + '%</span>';
  }
  function renderStats() {
    var rid = state.regionId, r = regions[rid], i = state.m, fr = flowRegion(rid);
    $('region-name').textContent = displayName(r);
    $('region-date').textContent = ymLabel(D.months[i]);
    [['unsold', rid], ['after', rid], ['start', fr], ['done', fr]].forEach(function (k) {
      var v = val(k[1], k[0], i);
      $('v-' + k[0]).textContent = v == null ? '-' : fmtNum(v) + '호';
      $('c-' + k[0]).innerHTML = chgSpan('전월', v, val(k[1], k[0], i - 1)) + chgSpan('전년 동월', v, val(k[1], k[0], i - 12));
    });
    var tag = r.level === 2 ? ' (' + regions[fr].name + ' 전체)' : ' (그 달)';
    $('l-start').textContent = '착공' + tag;
    $('l-done').textContent = '준공' + tag;
    var notes = [];
    if (r.level === 2) notes.push('착공·준공은 시도 단위 자료만 있어 ' + regions[fr].name + ' 전체 값을 보여줍니다.');
    if (r.level === 2 && !r.shapes.length) notes.push('지도 경계(2018년)에 없는 지역이라 목록에서만 고를 수 있습니다.');
    if (r.level === 2 && HIDE_SHAPES[r.shapes[0]]) notes.push(r.name + '은 섬 지역이라 시도 지도를 크게 보이도록 지도에서는 생략했습니다.');
    if (rid === '광주전남') notes.push('2026년 7월 통합(전남광주) 전후가 이어지도록 광주와 전남을 합친 값입니다.');
    $('region-note').textContent = notes.join(' ');
  }

  // ---------- 그래프 ----------
  var W = 720, ML = 58, MR = 16, MT = 14, MB = 30;
  function rangeStart() { var N = D.months.length; return state.years ? Math.max(0, N - state.years * 12) : 0; }
  function xTicks(svg, start, end, X, y) {
    var n = end - start + 1, every = n > 180 ? 5 : n > 96 ? 2 : 1;
    for (var i = start; i <= end; i++) {
      var m = D.months[i];
      if (n <= 36 ? m.slice(4) === '01' || m.slice(4) === '07' : m.slice(4) === '01' && +m.slice(0, 4) % every === 0)
        el('text', { x: X(i), y: y, 'text-anchor': 'middle' }, svg).textContent = n <= 36 ? ym(m) : m.slice(0, 4);
    }
  }
  // kind: 'line' 또는 'bar', keys: 그릴 항목, rid: 지역
  function chart(svgId, infoId, H, kind, keys, rid, get) {
    get = get || val;
    var svg = $(svgId), start = rangeStart(), end = D.months.length - 1, n = end - start + 1;
    svg.innerHTML = '';
    var vals = [0];
    keys.forEach(function (k) { for (var i = start; i <= end; i++) { var v = get(rid, k, i); if (v != null) vals.push(v); } });
    var R = niceRange(0, Math.max.apply(null, vals)), pw = W - ML - MR;
    function X(i) { return ML + (i - start + 0.5) / n * pw; }
    function Y(v) { return MT + (1 - (v - R.min) / (R.max - R.min)) * (H - MT - MB); }
    R.ticks.forEach(function (t) {
      el('line', { x1: ML, x2: W - MR, y1: Y(t), y2: Y(t), 'class': t === 0 ? 'axis' : 'grid' }, svg);
      el('text', { x: ML - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = fmtAxis(t);
    });
    xTicks(svg, start, end, X, H - 8);
    var band = el('rect', { y: MT, width: pw / n, height: H - MT - MB, fill: '#2563eb', opacity: 0.08 }, svg);
    band.setAttribute('x', X(state.m) - pw / n / 2);
    keys.forEach(function (k, ki) {
      if (kind === 'bar') {
        var bw = Math.max(0.6, pw / n * 0.42);
        for (var i = start; i <= end; i++) {
          var v = get(rid, k, i);
          if (v == null) continue;
          el('rect', { x: X(i) + (ki ? 0 : -bw), y: Y(v), width: bw, height: Math.max(0.5, Y(0) - Y(v)), fill: COLOR[k] }, svg);
        }
      } else {
        var d = '', pen = false;
        for (var j = start; j <= end; j++) {
          var w = get(rid, k, j);
          if (w == null) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + X(j).toFixed(1) + ',' + Y(w).toFixed(1); pen = true;
        }
        el('path', { d: d, fill: 'none', stroke: COLOR[k], 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, svg);
      }
    });
    var hit = el('rect', { x: ML, y: MT, width: pw, height: H - MT - MB, fill: 'transparent', style: 'cursor:pointer' }, svg);
    function idxOf(e) { var r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * (W / r.width); return Math.max(start, Math.min(end, start + Math.floor((px - ML) / pw * n))); }
    function info(i) {
      var sum = get === flowVal && state.flow === 'sum12';
      $(infoId).textContent = ymLabel(D.months[i]) + (sum ? ' (최근 12개월 합계)' : '') + ' · ' +
        keys.map(function (k) { return NAME[k] + ' ' + fmtNum(get(rid, k, i)) + '호'; }).join(' · ');
    }
    hit.addEventListener('pointermove', function (e) { info(idxOf(e)); });
    hit.addEventListener('pointerleave', function () { info(state.m); });
    hit.addEventListener('click', function (e) { setMonth(idxOf(e)); });
    info(state.m);
  }
  function renderCharts() {
    var rid = state.regionId, fr = flowRegion(rid);
    $('chart1-title').textContent = '미분양 추이 (' + displayName(regions[rid]) + ')';
    $('chart2-title').textContent = '착공·준공 실적 (' + regions[fr].name + ')';
    chart('chart1', 'info1', 320, 'line', ['unsold', 'after'], rid);
    chart('chart2', 'info2', 300, state.flow === 'month' ? 'bar' : 'line', ['start', 'done'], fr, flowVal);
  }

  // ---------- 조작 ----------
  function bindUi() {
    document.querySelectorAll('[data-metric]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.metric = b.dataset.metric;
        document.querySelectorAll('[data-metric]').forEach(function (x) { x.classList.toggle('on', x === b); });
        updateTitles(); recolor(); renderRank();
      });
    });
    document.querySelectorAll('#range [data-y]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.years = +b.dataset.y;
        document.querySelectorAll('#range [data-y]').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderCharts();
      });
    });
    document.querySelectorAll('#flow-mode [data-flow]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.flow = b.dataset.flow;
        document.querySelectorAll('#flow-mode [data-flow]').forEach(function (x) { x.classList.toggle('on', x === b); });
        renderCharts();
      });
    });
    $('month').addEventListener('input', function (e) { setMonth(+e.target.value); });
    $('btn-latest').addEventListener('click', function () { setMonth(D.months.length - 1); });
    $('btn-back').addEventListener('click', function () { selectSido(null); selectRegion('전국'); });
    $('sel-sido').addEventListener('change', function (e) {
      var r = regions[e.target.value];
      if (r.level === 0) { selectSido(null); selectRegion(r.id); } else { selectSido(r.id); selectRegion(r.id); }
    });
    $('sel-sgg').addEventListener('change', function (e) { selectRegion(e.target.value || state.sidoId); });
  }

  Promise.all([fetchJson('data/macro/supply.json'), fetchJson('data/geo_sido.json'), fetchJson('data/geo_sigungu.json')])
    .then(function (r) {
      D = r[0]; geoSido = r[1]; geoSgg = r[2];
      D.regions.forEach(function (x) { regions[x.id] = x; if (x.level === 1) sidos.push(x); });
      state.m = D.months.length - 1;
      $('month').max = state.m;
      $('lg-bar').style.background = 'linear-gradient(90deg, ' + rgb(lerp(SEQ_LO, SEQ_HI, 0.15)) + ', ' + rgb(SEQ_HI) + ')';   // 지도와 같은 빨강
      fillSidoSelect(); initMap(); bindUi(); fillSggSelect();
      setMonth(state.m);
      selectRegion('전국');
    })
    .catch(function (e) {
      console.error(e);
      $('region-note').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
    });
})();
