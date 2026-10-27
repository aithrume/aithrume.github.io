/* =========================================================
   foreign.js - 지역별 외국인 소유 공동주택 비율 지도
   데이터: data/foreign/foreign.json (tools/build_foreign.py 가 만들어 줌)
     periods : 반기 목록 [{id:'202502', label:'2025년 하반기', census:'2025'}]
     regions : 전국 / 시도(level 1) / 시군구(level 2) / 시 아래 구(level 3), shapes = 지도 경계 코드
     data    : 지역 → { h: 외국인 소유 주택 수[], o: 외국인 소유자 수[], t: 전체 공동주택 수[] } (반기 순서)
   ========================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  function $(id) { return document.getElementById(id); }

  var LON0 = 124.5, LAT1 = 38.7, KY = 100, KX = 100 * Math.cos(36 * Math.PI / 180);
  var FULL_VIEW = [0, 0, 607, 570];
  // 시도 확대 지도에서 그리지 않는 경계: 옹진군은 멀리 떨어진 섬들이라 함께 그리면 인천 본토가 너무 작아짐
  var HIDE_SHAPES = { '23320': '옹진군' };
  var HIDDEN_NOTE = '섬 지역이라 시도 지도를 크게 보이도록 지도에서는 생략했습니다. 목록에서 선택해 확인하세요.';
  function isHidden(name) { return Object.keys(HIDE_SHAPES).some(function (c) { return HIDE_SHAPES[c] === name; }); }
  var SEQ_LO = [235, 243, 255], SEQ_HI = [29, 78, 216];
  var METRIC_NAME = { r: '외국인 소유 비율', h: '외국인 소유 주택 수', o: '외국인 소유자 수' };

  var state = { metric: 'r', p: 0, sidoId: null, regionId: '전국', cmp: true };
  var D, regions = {}, sidos = [], geoSido, geoSgg, featByCode = {};
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
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    });
  }
  function lerp(a, b, t) { return a.map(function (x, i) { return Math.round(x + (b[i] - x) * t); }); }
  function rgb(c) { return 'rgb(' + c.join(',') + ')'; }
  function fmtNum(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function fmtPct(v) { return v == null ? '-' : v.toFixed(v < 1 ? 2 : 1) + '%'; }
  function fmt(metric, v) {
    if (v == null) return '-';
    return metric === 'r' ? fmtPct(v) : fmtNum(v) + (metric === 'o' ? '명' : '호');
  }

  // 지역·시점의 값 (비율은 외국인 소유 주택 ÷ 전체 공동주택)
  function val(rid, metric, i) {
    var s = D.data[rid];
    if (!s) return null;
    if (metric === 'r') return s.h[i] == null || !s.t[i] ? null : s.h[i] / s.t[i] * 100;
    return s[metric][i];
  }
  function displayName(r) {
    if (r.level === 3) return regions[r.parent].name + ' ' + r.name;
    return r.name;
  }

  // ---------- 지도 그리기 ----------
  function proj(p) { return ((p[0] - LON0) * KX).toFixed(1) + ',' + ((LAT1 - p[1]) * KY).toFixed(1); }
  function pathD(geom) {
    var d = '';
    geom.coordinates.forEach(function (poly) {
      poly.forEach(function (ring) { d += 'M' + ring.map(proj).join('L') + 'Z'; });
    });
    return d;
  }
  function bboxOf(features) {                    // 아주 작은 섬은 무시하고 화면 범위 계산
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
    var maxA = Math.max.apply(null, polys.map(function (p) { return p.a; }));
    var out = [1e9, 1e9, -1e9, -1e9];
    polys.forEach(function (p) {
      if (p.a < maxA * 0.05) return;
      out[0] = Math.min(out[0], p.b[0]); out[1] = Math.min(out[1], p.b[1]);
      out[2] = Math.max(out[2], p.b[2]); out[3] = Math.max(out[3], p.b[3]);
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
  function viewForBox(b) {
    var w = b[2] - b[0], h = b[3] - b[1], pad = Math.max(w, h) * 0.08;
    return [b[0] - pad, b[1] - pad, w + pad * 2, h + pad * 2];
  }

  function showTip(e, html) {
    var tip = $('map-tip'), box = tip.parentNode.getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false;
    var x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 10;
    if (y + tip.offsetHeight > box.height) y = e.clientY - box.top - tip.offsetHeight - 10;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  }
  function hideTip() { $('map-tip').hidden = true; }
  function tipHtml(rid, name) {
    if (!rid) return '<strong>' + name + '</strong><br>자료 없음';
    var i = state.p;
    return '<strong>' + displayName(regions[rid]) + '</strong><br>' +
      '외국인 소유 비율 ' + fmtPct(val(rid, 'r', i)) + '<br>' +
      '외국인 소유 ' + fmt('h', val(rid, 'h', i)) + ' · 소유자 ' + fmt('o', val(rid, 'o', i));
  }
  function bindShape(path, rid, name, onClick) {
    path.addEventListener('pointermove', function (e) { showTip(e, tipHtml(rid, name)); });
    path.addEventListener('pointerleave', hideTip);
    path.addEventListener('click', onClick);
  }

  function initMap() {
    var svg = $('kb-map');
    gS = el('g', {}, svg);
    gG = el('g', {}, svg);
    gL = el('g', { 'class': 'map-labels' }, svg);   // 지역명 (맨 위)
    var byGeo = {};
    sidos.forEach(function (r) { byGeo[r.geo] = r.id; });
    geoSido.features.forEach(function (f) {
      var rid = byGeo[f.properties.code] || null;
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gS);
      p.dataset.rid = rid || '';
      p.feature = f;
      sidoPaths[f.properties.code] = p;
      bindShape(p, rid, f.properties.name, function () { if (rid) onSidoClick(rid); });
    });
  }

  // 시군구 층: 이 시도에 속한 지역의 경계 + 같은 시도 코드의 남은 경계(자료 없음)
  function buildSggLayer(sidoId) {
    while (gG.firstChild) gG.removeChild(gG.firstChild);
    sggPaths = []; sggByCode = {};
    var s = regions[sidoId], codeMap = {}, owned = {};
    D.regions.forEach(function (r) { if (r.level >= 2) (r.shapes || []).forEach(function (c) { owned[c] = r.sido; }); });
    var cand = D.regions.filter(function (r) { return r.sido === sidoId && r.level >= 2; });
    cand.filter(function (r) { return r.level === 2; }).forEach(function (r) { (r.shapes || []).forEach(function (c) { codeMap[c] = r.id; }); });
    cand.filter(function (r) { return r.level === 3; }).forEach(function (r) { (r.shapes || []).forEach(function (c) { codeMap[c] = r.id; }); });
    geoSgg.features.forEach(function (f) {
      var code = f.properties.code, rid = codeMap[code] || null;
      if (HIDE_SHAPES[code]) return;
      if (!rid && (owned[code] || code.slice(0, 2) !== s.geo)) return;
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gG);
      p.dataset.rid = rid || ''; p.dataset.code = code; p.feature = f;
      if (!rid) p.classList.add('nodata');
      bindShape(p, rid, f.properties.name, function () { if (rid) selectRegion(rid); });
      sggPaths.push(p); sggByCode[code] = p;
    });
  }

  // ---------- 색칠 ----------
  function colorMap(rids) {
    var out = {}, nums = [];
    rids.forEach(function (r) { var v = val(r, state.metric, state.p); if (v != null) nums.push(v); });
    var sorted = nums.slice().sort(function (a, b) { return a - b; });
    rids.forEach(function (r) {
      var v = val(r, state.metric, state.p);
      if (v == null) { out[r] = null; return; }
      var t = sorted.length > 1 ? sorted.indexOf(v) / (sorted.length - 1) : 0.5;   // 순위 기준 색
      out[r] = rgb(lerp(SEQ_LO, SEQ_HI, t));
    });
    $('lg-min').textContent = sorted.length ? '낮음 ' + fmt(state.metric, sorted[0]) : '낮음';
    $('lg-max').textContent = sorted.length ? '높음 ' + fmt(state.metric, sorted[sorted.length - 1]) : '높음';
    return out;
  }
  function recolor() {
    var paths = state.sidoId == null ? Object.keys(sidoPaths).map(function (c) { return sidoPaths[c]; }) : sggPaths;
    var rids = [];
    paths.forEach(function (p) { if (p.dataset.rid && rids.indexOf(p.dataset.rid) < 0) rids.push(p.dataset.rid); });
    var m = colorMap(rids);
    paths.forEach(function (p) { p.setAttribute('fill', (p.dataset.rid && m[p.dataset.rid]) || '#e5e7eb'); });
    renderLabels(paths);
  }
  // 지역명: 자료가 있는 곳 먼저, 남는 자리에 자료 없는 곳
  function renderLabels(paths) {
    var byKey = {}, nat = state.sidoId == null;
    paths.forEach(function (p) {
      var rid = p.dataset.rid, code = p.feature.properties.code;
      var has = rid && val(rid, state.metric, state.p) != null;
      var key = rid || 'g:' + code;
      var text = nat ? MapLabels.SIDO_SHORT[code] || p.feature.properties.name
                     : rid ? regions[rid].name : p.feature.properties.name.replace(/^.+시(.+구)$/, '$1');
      var pri = has ? (nat ? MapLabels.sidoPriority(code) : 0) : -1;
      (byKey[key] = byKey[key] || { text: text, features: [], priority: pri }).features.push(p.feature);
    });
    MapLabels.draw(gL, Object.keys(byKey).map(function (k) { return byKey[k]; }), targetView);
  }

  function shapesFor(rid) {
    var r = regions[rid], out = [];
    if (!r) return out;
    if (r.level === 1) {
      if (state.sidoId == null && sidoPaths[r.geo]) out.push(sidoPaths[r.geo]);
      return out;
    }
    var codes = r.shapes || [];
    if (!codes.length && r.level === 3) codes = regions[r.parent].shapes || [];   // 경계 없는 구 → 상위 시
    codes.forEach(function (c) { if (sggByCode[c]) out.push(sggByCode[c]); });
    return out;
  }
  function highlight() {
    Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.remove('sel'); });
    sggPaths.forEach(function (p) { p.classList.remove('sel'); });
    shapesFor(state.regionId).forEach(function (p) { p.classList.add('sel'); });
  }

  // ---------- 선택 동작 ----------
  function onSidoClick(rid) {
    if (state.sidoId === rid) { selectRegion(rid); return; }
    selectSido(rid); selectRegion(rid);
  }
  function selectSido(sidoId) {
    var s = sidoId ? regions[sidoId] : null;
    if (!s || !s.geo) {
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
    syncSelects(); highlight(); renderRank(); renderStats(); renderChart();
    $('cmp').disabled = rid === '전국';
  }
  function setPeriod(i) {
    state.p = Math.max(0, Math.min(D.periods.length - 1, i));
    $('period').value = state.p;
    $('period-label').textContent = D.periods[state.p].label;
    updateTitles(); recolor(); renderRank(); renderStats(); renderChart();
  }

  // ---------- 선택 상자 ----------
  function fillSidoSelect() {
    var h = '<option value="전국">전국</option>';
    sidos.forEach(function (r) { h += '<option value="' + r.id + '">' + r.name + '</option>'; });
    $('sel-sido').innerHTML = h;
  }
  function fillSggSelect() {
    var sel = $('sel-sgg');
    if (!state.sidoId) { sel.innerHTML = '<option value="">시도를 먼저 선택</option>'; sel.disabled = true; return; }
    var h = '<option value="">(시도 전체)</option>';
    D.regions.forEach(function (r) {
      if (r.sido !== state.sidoId || r.level < 2) return;
      h += '<option value="' + r.id + '">' + (r.level === 3 ? '  ' : '') + r.name + '</option>';
    });
    sel.innerHTML = h; sel.disabled = false;
  }
  function syncSelects() {
    var r = regions[state.regionId];
    $('sel-sido').value = r.level === 0 ? '전국' : r.sido;
    $('sel-sgg').value = r.level >= 2 ? r.id : '';
  }
  function updateTitles() {
    var area = state.sidoId ? regions[state.sidoId].name + ' 시군구별' : '전국 시도별';
    $('map-title').textContent = area + ' ' + METRIC_NAME[state.metric] + ' (' + D.periods[state.p].label + ')';
    $('rank-title').textContent = (state.sidoId ? '시군구별' : '시도별') + ' ' + METRIC_NAME[state.metric] + ' 순위';
  }

  // ---------- 순위 ----------
  function renderRank() {
    var ids = state.sidoId == null ? sidos.map(function (r) { return r.id; })
      : D.regions.filter(function (r) { return r.sido === state.sidoId && r.level >= 2; }).map(function (r) { return r.id; });
    var rows = ids.map(function (id) { return { id: id, v: val(id, state.metric, state.p) }; });
    rows.sort(function (a, b) { return a.v == null ? 1 : b.v == null ? -1 : b.v - a.v; });
    var max = Math.max.apply(null, rows.map(function (x) { return x.v || 0; }).concat([1e-9]));
    var ol = $('rank'); ol.innerHTML = '';
    rows.forEach(function (it) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      if (it.id === state.regionId) b.className = 'on';
      var bar = it.v == null ? '' : '<i style="left:0;background:#2563eb;width:' + (it.v / max * 100) + '%"></i>';
      b.innerHTML = '<span>' + displayName(regions[it.id]) + '</span><span class="bar left">' + bar +
                    '</span><span class="num">' + fmt(state.metric, it.v) + '</span>';
      b.addEventListener('click', function () { if (state.sidoId == null) onSidoClick(it.id); else selectRegion(it.id); });
      li.appendChild(b); ol.appendChild(li);
    });
  }

  // ---------- 숫자 카드 ----------
  function chg(label, now, prev, pp) {               // pp: 비율이면 %p 차이
    if (now == null || prev == null || (!pp && !prev)) return '<span class="muted">' + label + ' -</span>';
    var d = pp ? now - prev : (now - prev) / prev * 100;
    var arrow = d > 0 ? '▲ ' : d < 0 ? '▼ ' : '– ';
    return '<span class="' + (d > 0 ? 'up' : d < 0 ? 'down' : '') + '">' + label + ' ' + arrow +
           Math.abs(d).toFixed(pp ? 3 : 1) + (pp ? '%p' : '%') + '</span>';
  }
  function renderStats() {
    var rid = state.regionId, i = state.p, prev = i > 0 ? i - 1 : null, P = D.periods[i];
    function pv(m) { return prev == null ? null : val(rid, m, prev); }
    $('region-name').textContent = displayName(regions[rid]);
    $('region-date').textContent = P.label;
    $('v-r').textContent = fmtPct(val(rid, 'r', i));
    $('c-r').innerHTML = chg('직전 반기', val(rid, 'r', i), pv('r'), true);
    $('v-h').textContent = fmt('h', val(rid, 'h', i));
    $('c-h').innerHTML = chg('직전 반기', val(rid, 'h', i), pv('h'));
    $('v-o').textContent = fmt('o', val(rid, 'o', i));
    $('c-o').innerHTML = chg('직전 반기', val(rid, 'o', i), pv('o'));
    $('v-t').textContent = fmt('h', val(rid, 't', i));
    $('c-t').innerHTML = '<span class="muted">' + P.census + '년 총조사</span>';
    var notes = [];
    if (val(rid, 'h', i) == null) notes.push('이 시점에는 부동산원 자료가 공개되지 않았습니다(소유자 5명 미만 등).');
    else if (val(rid, 't', i) == null) notes.push('이 시점 총조사에 이 지역 공동주택 수가 따로 없어 비율을 계산할 수 없습니다.');
    if (rid === '전국') notes.push('전국 소유자 수는 시도 합계라 여러 시도에 주택을 가진 소유자가 중복됩니다.');
    if (regions[rid].level >= 2 && isHidden(regions[rid].name)) notes.push(regions[rid].name + '은 ' + HIDDEN_NOTE);
    else if (regions[rid].level >= 2 && !shapesFor(rid).length && state.sidoId) notes.push('2018년 지도 경계에 없는 지역이라 목록에서만 고를 수 있습니다.');
    $('region-note').textContent = notes.join(' ');
  }

  // ---------- 그래프 (반기별 비율) ----------
  var W = 720, H = 320, ML = 56, MR = 70, MT = 16, MB = 34;
  function niceTicks(min, max) {
    var range = max - min || 1, rough = range / 5;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var t = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(v);
    return t;
  }
  function renderChart() {
    var rid = state.regionId, N = D.periods.length, svg = $('kb-chart');
    $('chart-title').textContent = '외국인 소유 비율 추이 (' + displayName(regions[rid]) + ')';
    svg.innerHTML = '';
    var mine = D.periods.map(function (_, i) { return val(rid, 'r', i); });
    var nat = state.cmp && rid !== '전국' ? D.periods.map(function (_, i) { return val('전국', 'r', i); }) : null;
    var all = mine.concat(nat || []).filter(function (v) { return v != null; });
    if (!all.length) {
      el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#9ca3af', 'font-size': 18 }, svg).textContent = '표시할 자료가 없습니다';
      $('hover-info').textContent = '';
      return;
    }
    var min = Math.min.apply(null, all), max = Math.max.apply(null, all), pad = (max - min) * 0.15 || max * 0.1 || 0.1;
    min = Math.max(0, min - pad); max += pad;
    var pw = W - ML - MR;
    function X(i) { return ML + (i + 0.5) / N * pw; }
    function Y(v) { return MT + (1 - (v - min) / (max - min)) * (H - MT - MB); }
    var bw = pw / N;
    el('rect', { x: X(state.p) - bw / 2, y: MT, width: bw, height: H - MT - MB, 'class': 'sel-band' }, svg);
    niceTicks(min, max).forEach(function (t) {
      el('line', { x1: ML, x2: W - MR, y1: Y(t), y2: Y(t), 'class': 'grid' }, svg);
      el('text', { x: ML - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg).textContent = t.toFixed(t < 1 ? 2 : 1) + '%';
    });
    D.periods.forEach(function (p, i) {
      el('text', { x: X(i), y: H - 12, 'text-anchor': 'middle' }, svg).textContent = p.id.slice(2, 4) + (p.id.slice(4) === '01' ? '상' : '하');
    });
    function line(data, color, w, dash) {
      var d = '', pen = false;
      data.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); pen = true;
      });
      var a = { d: d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linejoin': 'round' };
      if (dash) a['stroke-dasharray'] = dash;
      el('path', a, svg);
      data.forEach(function (v, i) { if (v != null) el('circle', { cx: X(i), cy: Y(v), r: dash ? 2.4 : 3.4, fill: color }, svg); });
    }
    if (nat) line(nat, '#9ca3af', 1.6, '4 3');
    line(mine, '#2563eb', 2.6);
    var last = -1;
    mine.forEach(function (v, i) { if (v != null) last = i; });
    if (last >= 0) el('text', { x: X(last) + 8, y: Y(mine[last]) + 4, style: 'font-weight:700;font-size:14px;fill:#2563eb' }, svg).textContent = fmtPct(mine[last]);

    // 마우스를 올리면 정보, 누르면 그 시점으로
    var hit = el('rect', { x: ML, y: MT, width: pw, height: H - MT - MB, fill: 'transparent', style: 'cursor:pointer' }, svg);
    function idxOf(e) {
      var rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) * (W / rect.width);
      return Math.max(0, Math.min(N - 1, Math.floor((px - ML) / pw * N)));
    }
    function info(i) {
      var parts = [D.periods[i].label, '비율 ' + fmtPct(mine[i]), '외국인 소유 ' + fmt('h', val(rid, 'h', i))];
      if (nat) parts.push('전국 ' + fmtPct(nat[i]));
      $('hover-info').textContent = parts.join(' · ');
    }
    hit.addEventListener('pointermove', function (e) { info(idxOf(e)); });
    hit.addEventListener('pointerleave', function () { info(state.p); });
    hit.addEventListener('click', function (e) { setPeriod(idxOf(e)); });
    info(state.p);
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
    $('period').addEventListener('input', function (e) { setPeriod(+e.target.value); });
    $('btn-latest').addEventListener('click', function () { setPeriod(D.periods.length - 1); });
    $('btn-back').addEventListener('click', function () { selectSido(null); selectRegion('전국'); });
    $('sel-sido').addEventListener('change', function (e) {
      var v = e.target.value;
      if (v === '전국') { selectSido(null); selectRegion('전국'); } else { selectSido(v); selectRegion(v); }
    });
    $('sel-sgg').addEventListener('change', function (e) { selectRegion(e.target.value || state.sidoId); });
    $('cmp').addEventListener('change', function (e) { state.cmp = e.target.checked; renderChart(); });
  }

  // ---------- 시작 ----------
  Promise.all([fetchJson('data/foreign/foreign.json'), fetchJson('data/geo_sido.json'), fetchJson('data/geo_sigungu.json')])
    .then(function (r) {
      D = r[0]; geoSido = r[1]; geoSgg = r[2];
      D.regions.forEach(function (x) { regions[x.id] = x; if (x.level === 1) sidos.push(x); });
      geoSgg.features.forEach(function (f) { featByCode[f.properties.code] = f; });
      state.p = D.periods.length - 1;
      $('period').max = state.p;
      fillSidoSelect(); initMap(); bindUi(); fillSggSelect();
      setPeriod(state.p);
      selectRegion('전국');
    })
    .catch(function (e) {
      console.error(e);
      $('region-note').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
    });
})();
