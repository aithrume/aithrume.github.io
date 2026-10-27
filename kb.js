/* =========================================================
   kb.js - KB 주간 시세 지도 + 그래프 (외부 라이브러리 없이 SVG로 직접 그림)
   ---------------------------------------------------------
   데이터: data/kb/ 폴더의 JSON (지도 경계는 data/geo_*.json) (tools/build_data.py 가 엑셀에서 만들어 줌)
   - index.json      : 날짜 목록, 시도/시군구 목록
   - map_sido.json   : 시도별 모든 주의 증감률 (지도 색칠용)
   - sido_XX.json    : 시도 하나의 시군구별 지수/증감률 (필요할 때만 불러옴)
   - aggregate.json  : 전국·수도권 등 합산 지역
   - geo_sido.json / geo_sigungu.json : 지도 경계(GeoJSON)
   ========================================================= */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  function $(id) { return document.getElementById(id); }

  // ---------- 설정값 ----------
  var COLOR_RANGE = 0.3;           // 주간 변동률 ±0.3% 에서 색이 가장 진해짐
  var LON0 = 124.5, LAT1 = 38.7;   // 지도 왼쪽 위 기준 (경도, 위도)
  var KY = 100;                    // 위도 1도 = 100 단위
  var KX = 100 * Math.cos(36 * Math.PI / 180); // 경도 1도의 가로 길이(한국 위도 기준 보정)
  var FULL_VIEW = [0, 0, 607, 570];
  // 시도 확대 지도에서 그리지 않는 경계: 옹진군은 멀리 떨어진 섬들이라 함께 그리면 인천 본토가 너무 작아짐
  var HIDE_SHAPES = { '23320': '옹진군' };
  var HIDDEN_NOTE = '섬 지역이라 시도 지도를 크게 보이도록 지도에서는 생략했습니다. 목록에서 선택해 확인하세요.';
  function isHidden(name) { return Object.keys(HIDE_SHAPES).some(function (c) { return HIDE_SHAPES[c] === name; }); }
  // 2018년 경계에는 옛 이름으로 남아 있는 구 (KB 이름 → 경계 이름)
  var ALIAS = { '23|미추홀구': '남구' };

  // ---------- 상태 ----------
  var state = { metric: 'sc', week: 0, sidoId: null, regionId: 'a1', range: 260, cmp: true, hover: null,
                noData: null };   // noData: KB 시세가 없는 지역을 골랐을 때 그 지도 경계(path)
  var idx, mapSido, geoSido, geoSgg, aggSeries;
  var regions = {};               // id → 지역 정보
  var fileCache = {};             // 시도 파일 캐시 (Promise)
  var fileData = {};              // 시도 파일 데이터 (불러온 뒤)
  var sidoPaths = {};             // 시도코드 → <path>
  var sggPaths = [];              // 지금 보이는 시군구 <path> 들
  var curView = FULL_VIEW.slice();
  var targetView = FULL_VIEW.slice();   // 이동이 끝난 뒤의 화면 (지역명 크기 계산용)
  var viewAnim = 0, drillToken = 0, chartToken = 0;
  var chartCtx = null;

  // ---------- 작은 도구들 ----------
  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function fmtDate(d) { return d.replace(/-/g, '.'); }
  function fmtPct(v) {
    if (v == null) return '-';
    return (v > 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function colorFor(v) {
    if (v == null) return '#e5e7eb';
    var t = Math.max(-1, Math.min(1, v / COLOR_RANGE));
    var mid = [238, 240, 243], tgt = t >= 0 ? [220, 38, 38] : [37, 99, 235], a = Math.abs(t);
    return 'rgb(' + mid.map(function (m, i) { return Math.round(m + (tgt[i] - m) * a); }).join(',') + ')';
  }
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' 을(를) 불러오지 못했습니다.');
      return r.json();
    });
  }
  // 배열에서 w 주차 이하로 거슬러 올라가며 처음 나오는 값
  function pick(arr, w) {
    for (var i = w; i >= 0; i--) if (arr[i] != null) return { v: arr[i], i: i };
    return null;
  }

  // ---------- 지역 정보 / 시리즈 불러오기 ----------
  function buildRegions() {
    idx.agg.forEach(function (a) { regions[a.id] = { id: a.id, name: a.name, agg: true, file: 'agg' }; });
    idx.sido.forEach(function (s) {
      regions[s.id] = { id: s.id, name: s.name, level: 1, geo: s.geo, file: s.file, sidoId: s.id, children: [] };
      s.children.forEach(function (c) {
        regions[c.id] = { id: c.id, name: c.name, level: c.level, parent: c.parent, si_name: c.si_name,
                          sidoId: s.id, file: s.file };
        regions[s.id].children.push(c.id);
      });
    });
  }
  function loadFile(code) {
    if (!fileCache[code]) {
      fileCache[code] = fetchJson('data/kb/sido_' + code + '.json').then(function (d) { fileData[code] = d; return d; });
    }
    return fileCache[code];
  }
  function getSeries(rid) {
    var r = regions[rid];
    if (r.agg) return Promise.resolve(aggSeries[rid]);
    return loadFile(r.file).then(function (d) { return d[rid]; });
  }
  function seriesNow(rid) {            // 이미 불러온 경우에만 즉시 반환
    var r = regions[rid];
    if (r.agg) return aggSeries[rid];
    return fileData[r.file] ? fileData[r.file][rid] : null;
  }
  function valueNow(rid, metric, w) { // 지도 색칠용 값
    var r = regions[rid];
    if (r && r.level === 1 && mapSido[rid]) return mapSido[rid][metric][w];
    var s = seriesNow(rid);
    return s ? s[metric][w] : null;
  }
  function displayName(r) {
    if (r.level === 3 && r.si_name) return r.si_name + ' ' + r.name;
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
  // 경계 상자(화면 맞춤용). 아주 작은 섬은 무시해서 울릉도 때문에 경북이 작아 보이지 않게 함
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

  var gS, gG, gL;
  function initMap() {
    var svg = $('kb-map');
    gS = el('g', {}, svg);
    gG = el('g', {}, svg);
    gL = el('g', { 'class': 'map-labels' }, svg);   // 지역명 (맨 위)
    geoSido.features.forEach(function (f) {
      var code = f.properties.code;
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gS);
      p.dataset.rid = 's' + code;
      p.feature = f;
      sidoPaths[code] = p;
      bindShape(p, function () { return 's' + code; }, function () { onSidoClick('s' + code); });
    });
  }

  // 말풍선
  function showTip(e, html) {
    var tip = $('map-tip'), box = $('map-tip').parentNode.getBoundingClientRect();
    tip.innerHTML = html; tip.hidden = false;
    var x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 10;
    if (y + tip.offsetHeight > box.height) y = e.clientY - box.top - tip.offsetHeight - 10;
    tip.style.left = Math.max(0, x) + 'px'; tip.style.top = Math.max(0, y) + 'px';
  }
  function hideTip() { $('map-tip').hidden = true; }
  function tipHtml(rid, fallbackName) {
    if (!rid) return '<strong>' + fallbackName + '</strong><br>KB 자료 없음';
    var r = regions[rid], v = valueNow(rid, state.metric, state.week);
    return '<strong>' + displayName(r) + '</strong><br>' + (state.metric === 'sc' ? '매매 ' : '전세 ') + fmtPct(v);
  }
  function bindShape(path, ridFn, onClick, nameFn) {
    path.addEventListener('pointermove', function (e) { showTip(e, tipHtml(ridFn(), nameFn ? nameFn() : '')); });
    path.addEventListener('pointerleave', hideTip);
    path.addEventListener('click', onClick);
  }

  // 시군구 층 만들기
  function buildSggLayer(sidoId) {
    while (gG.firstChild) gG.removeChild(gG.firstChild);
    sggPaths = [];
    var s = regions[sidoId], geoCode = s.geo;
    var gname = {};   // 경계 이름 → KB 지역 id
    s.children.forEach(function (cid) {
      var c = regions[cid];
      var n = c.level === 3 ? c.si_name + c.name : c.name;
      var al = ALIAS[geoCode + '|' + c.name];
      gname[al || n] = cid;
    });
    geoSgg.features.forEach(function (f) {
      if (f.properties.code.slice(0, 2) !== geoCode || HIDE_SHAPES[f.properties.code]) return;
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gG);
      var rid = gname[f.properties.name] || null;
      p.dataset.rid = rid || '';
      p.dataset.gname = f.properties.name;
      p.feature = f;
      if (!rid) { p.classList.add('nodata'); p.style.cursor = 'pointer'; }
      bindShape(p, function () { return rid; }, function () { if (rid) selectRegion(rid); else selectNoData(p); },
                function () { return f.properties.name; });
      sggPaths.push(p);
    });
  }

  function recolor() {
    Object.keys(sidoPaths).forEach(function (code) {
      sidoPaths[code].setAttribute('fill', colorFor(valueNow('s' + code, state.metric, state.week)));
    });
    sggPaths.forEach(function (p) {
      var rid = p.dataset.rid;
      p.setAttribute('fill', rid ? colorFor(valueNow(rid, state.metric, state.week)) : '#e5e7eb');
    });
    renderLabels();
  }

  // 지역명: 전국이면 시도, 시도 안이면 시군구. KB 자료가 없는 지역은 이름도 생략
  function renderLabels() {
    var items = [];
    if (state.sidoId == null) {
      Object.keys(sidoPaths).forEach(function (code) {
        var has = valueNow('s' + code, state.metric, state.week) != null;
        items.push({ text: MapLabels.SIDO_SHORT[code] || regions['s' + code].name, features: [sidoPaths[code].feature],
                     priority: has ? MapLabels.sidoPriority(code) : -1 });
      });
    } else {
      var byKey = {};
      sggPaths.forEach(function (p) {
        var rid = p.dataset.rid, has = rid && valueNow(rid, state.metric, state.week) != null;
        var key = rid || 'g:' + p.dataset.gname;
        var text = rid ? regions[rid].name : shortGeoName(p.dataset.gname);
        (byKey[key] = byKey[key] || { text: text, features: [], priority: has ? 0 : -1 }).features.push(p.feature);
      });
      items = Object.keys(byKey).map(function (k) { return byKey[k]; });
    }
    MapLabels.draw(gL, items, targetView);
  }
  // 경계 이름 '수원시장안구' → '장안구' (시 아래 구는 구 이름만)
  function shortGeoName(n) { var m = /^.+시(.+구)$/.exec(n); return m ? m[1] : n; }

  // 선택한 지역을 지도에서 강조
  function shapesFor(rid) {
    var r = regions[rid], out = [];
    if (!r || r.agg) return out;
    if (r.level === 1) {
      if (state.sidoId == null && r.geo && sidoPaths[r.geo]) out.push(sidoPaths[r.geo]);
      return out;
    }
    var direct = sggPaths.filter(function (p) { return p.dataset.rid === rid; });
    if (direct.length) return direct;
    if (r.level === 3 && r.parent) {                       // 경계가 없는 신설 구 → 상위 시 경계
      var pd = sggPaths.filter(function (p) { return p.dataset.rid === r.parent; });
      if (pd.length) return pd;
    }
    if (r.level === 2) {                                   // 시 전체 → 소속 구 경계 모두
      return sggPaths.filter(function (p) { return p.dataset.gname.indexOf(r.name) === 0; });
    }
    return out;
  }
  function highlight() {
    Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.remove('sel'); });
    sggPaths.forEach(function (p) { p.classList.remove('sel'); });
    if (state.noData) { state.noData.classList.add('sel'); return; }
    shapesFor(state.regionId).forEach(function (p) { p.classList.add('sel'); });
  }

  // ---------- 선택 동작 ----------
  function onSidoClick(rid) {
    if (state.sidoId === rid) { selectRegion(rid); return; }
    selectSido(rid).then(function () { selectRegion(rid); });
  }

  // 시도로 내려가기 (null 이면 전국으로 돌아가기)
  function selectSido(sidoId) {
    var tok = ++drillToken;
    var s = sidoId ? regions[sidoId] : null;
    if (!s || !s.geo || !s.children.length) {       // 내려갈 시군구가 없으면 전국 화면 유지
      state.sidoId = null;
      while (gG.firstChild) gG.removeChild(gG.firstChild);
      sggPaths = [];
      Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.remove('dim'); });
      animateView(FULL_VIEW);
      afterDrill();
      return Promise.resolve();
    }
    return loadFile(s.file).then(function () {
      if (tok !== drillToken) return;
      state.sidoId = sidoId;
      buildSggLayer(sidoId);
      Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.toggle('dim', 's' + c !== sidoId); });
      var feats = geoSgg.features.filter(function (f) { return f.properties.code.slice(0, 2) === s.geo && !HIDE_SHAPES[f.properties.code]; });
      animateView(viewForBox(bboxOf(feats)));
      afterDrill();
    });
  }
  function afterDrill() {
    fillSggSelect();
    syncSelects();
    updateTitles();
    recolor();
    highlight();
    renderRank();
    $('btn-back').hidden = state.sidoId == null;
  }

  function selectRegion(rid) {
    state.regionId = rid;
    state.noData = null;
    state.hover = null;
    syncSelects();
    highlight();
    renderRank();
    renderStats();
    renderChart();
    $('cmp').disabled = rid === 'a1';
  }

  // KB 시세가 없는 지역을 고르면 오른쪽 상세·그래프를 비움
  function selectNoData(path) {
    state.noData = path;
    state.hover = null;
    highlight();
    $('sel-sgg').value = '';
    showNoData();
  }
  function showNoData() {
    var name = shortGeoName(state.noData.dataset.gname);
    var full = state.sidoId ? regions[state.sidoId].name + ' ' + name : name;
    ++chartToken;                                   // 불러오던 그래프가 있으면 무시
    $('region-name').textContent = full;
    $('region-date').textContent = '';
    ['v-si', 'v-ji'].forEach(function (id) { $(id).textContent = '-'; });
    ['c-sc', 'c-jc'].forEach(function (id) { setChg(id, null); });
    $('region-note').textContent = 'KB 시세가 제공되지 않는 지역입니다.';
    $('chart-title').textContent = 'KB 지수 추이 (' + full + ')';
    var svg = $('kb-chart');
    svg.innerHTML = '';
    el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: '#9ca3af', 'font-size': 18 }, svg).textContent = 'KB 시세 자료가 없습니다';
    chartCtx = null;
    $('hover-info').textContent = '';
    $('chart-base').textContent = '';
  }

  // ---------- 선택 상자 ----------
  function fillSidoSelect() {
    var sel = $('sel-sido'), html = '<optgroup label="전국·권역">';
    idx.agg.forEach(function (a) { html += '<option value="' + a.id + '">' + a.name + '</option>'; });
    html += '</optgroup><optgroup label="시도">';
    idx.sido.forEach(function (s) { html += '<option value="' + s.id + '">' + s.name + '</option>'; });
    sel.innerHTML = html + '</optgroup>';
  }
  function fillSggSelect() {
    var sel = $('sel-sgg'), s = state.sidoId ? regions[state.sidoId] : null;
    if (!s) {
      var r0 = regions[state.regionId];
      var sd = r0 && r0.sidoId ? regions[r0.sidoId] : null;
      sel.innerHTML = '<option value="">' + (sd && sd.children.length ? '(시도 전체)' : '시도를 먼저 선택') + '</option>';
      sel.disabled = true;
      return;
    }
    var html = '<option value="">(시도 전체)</option>';
    s.children.forEach(function (cid) {
      var c = regions[cid];
      html += '<option value="' + cid + '">' + (c.level === 3 ? '  └ ' : '') + c.name + '</option>';
    });
    sel.innerHTML = html;
    sel.disabled = false;
  }
  function syncSelects() {
    var r = regions[state.regionId];
    var sidoVal = r.agg ? r.id : r.sidoId;
    $('sel-sido').value = sidoVal;
    var inDrill = state.sidoId && r.sidoId === state.sidoId;
    $('sel-sgg').value = inDrill && r.level >= 2 ? r.id : '';
  }
  function updateTitles() {
    var m = state.metric === 'sc' ? '매매' : '전세';
    var date = fmtDate(idx.dates[state.week]);
    var area = state.sidoId ? regions[state.sidoId].name + ' 시군구별' : '전국 시도별';
    $('map-title').textContent = area + ' ' + m + ' 주간 변동률 (' + date + ' 기준)';
    $('rank-title').textContent = (state.sidoId ? '시군구별' : '시도별') + ' ' + m + ' 변동률 순위';
    $('week-label').textContent = date;
  }

  // ---------- 순위 목록 ----------
  function renderRank() {
    var items = [];
    if (state.sidoId == null) {
      idx.sido.forEach(function (s) {
        if (s.geo) items.push({ id: s.id, label: s.name, v: valueNow(s.id, state.metric, state.week) });
      });
    } else {
      regions[state.sidoId].children.forEach(function (cid) {
        items.push({ id: cid, label: displayName(regions[cid]), v: valueNow(cid, state.metric, state.week) });
      });
    }
    items.sort(function (a, b) {
      if (a.v == null) return 1;
      if (b.v == null) return -1;
      return b.v - a.v;
    });
    var ol = $('rank'); ol.innerHTML = '';
    items.forEach(function (it) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      if (it.id === state.regionId) b.className = 'on';
      var w = it.v == null ? 0 : Math.min(1, Math.abs(it.v) / 0.8) * 50;
      var bar = it.v == null ? '' :
        '<i style="' + (it.v >= 0 ? 'left:50%;background:#dc2626;' : 'right:50%;background:#2563eb;') + 'width:' + w + '%"></i>';
      b.innerHTML = '<span>' + it.label + '</span><span class="bar">' + bar + '</span><span class="num ' +
        (it.v > 0 ? 'up' : it.v < 0 ? 'down' : '') + '">' + fmtPct(it.v) + '</span>';
      b.addEventListener('click', function () {
        if (state.sidoId == null) onSidoClick(it.id); else selectRegion(it.id);
      });
      li.appendChild(b); ol.appendChild(li);
    });
  }

  // ---------- 숫자 카드 ----------
  function setChg(elId, v) {
    var e = $(elId);
    if (v == null) { e.textContent = '자료 없음'; e.className = 'stat-chg muted'; return; }
    var arrow = v > 0 ? '▲ ' : v < 0 ? '▼ ' : '– ';
    e.textContent = '전주 대비 ' + arrow + Math.abs(v).toFixed(2) + '%';
    e.className = 'stat-chg ' + (v > 0 ? 'up' : v < 0 ? 'down' : '');
  }
  function renderStats() {
    if (state.noData) { showNoData(); return; }      // 주·지표를 바꿔도 빈 상태 유지
    var rid = state.regionId, r = regions[rid];
    $('region-name').textContent = displayName(r);
    getSeries(rid).then(function (s) {
      if (rid !== state.regionId) return;
      var w = state.week, notes = [];
      var si = pick(s.si, w), ji = pick(s.ji, w);
      $('v-si').textContent = si ? si.v.toFixed(2) : '-';
      $('v-ji').textContent = ji ? ji.v.toFixed(2) : '-';
      setChg('c-sc', s.sc[w]);
      setChg('c-jc', s.jc[w]);
      var last = Math.max(si ? si.i : -1, ji ? ji.i : -1);
      $('region-date').textContent = fmtDate(idx.dates[w]) + ' 기준';
      if ((si && si.i !== w) || (ji && ji.i !== w))
        notes.push('이 지역은 ' + fmtDate(idx.dates[last]) + ' 이후 KB 자료가 없어 그 시점 값을 보여줍니다.');
      if (r.level >= 2 && isHidden(r.name))
        notes.push(r.name + '은 ' + HIDDEN_NOTE);
      else if (r.level >= 2 && shapesFor(rid).length === 0)
        notes.push('지도 경계가 없는 지역입니다(2018년 경계 기준). 목록에서 선택해 확인하세요.');
      if (r.level === 1 && !r.geo)
        notes.push('전남광주통합특별시는 2026.7 출범해 자료가 짧고, 지도에는 (구)광주·(구)전남으로 나뉘어 표시됩니다.');
      $('region-note').textContent = notes.join(' ');
    }).catch(showError);
  }
  function showError(e) {
    console.error(e);
    $('region-note').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
  }

  // ---------- 그래프 ----------
  var W = 720, H = 320, ML = 54, MR = 76, MT = 14, MB = 30;

  function niceTicks(min, max) {
    var range = max - min || 1, rough = range / 5;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var t = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(v);
    return t;
  }

  function renderChart() {
    if (state.noData) { showNoData(); return; }
    var rid = state.regionId, tok = ++chartToken;
    $('chart-title').textContent = 'KB 지수 추이 (' + displayName(regions[rid]) + ')';
    getSeries(rid).then(function (s) {
      if (tok !== chartToken) return;
      var nat = (state.cmp && rid !== 'a1') ? aggSeries['a1'] : null;
      var dates = idx.dates, n = dates.length, end = n - 1;
      var start = state.range ? Math.max(0, n - 1 - state.range) : 0;

      var lines = [
        { key: 'si', name: '매매', color: '#2563eb', data: s.si, w: 2.2 },
        { key: 'ji', name: '전세', color: '#f59e0b', data: s.ji, w: 2.2 }
      ];
      if (nat) lines.push({ key: 'nat', name: '전국 매매', color: '#9ca3af', data: nat.si, w: 1.6, dash: '4 3' });

      var min = 1e9, max = -1e9;
      lines.forEach(function (l) {
        for (var i = start; i <= end; i++) {
          var v = l.data[i];
          if (v == null) continue;
          if (v < min) min = v; if (v > max) max = v;
        }
      });
      var svg = $('kb-chart');
      svg.innerHTML = '';
      if (min > max) {
        el('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle' }, svg).textContent = '표시할 자료가 없습니다';
        chartCtx = null; $('hover-info').textContent = ''; return;
      }
      var pad = (max - min) * 0.08 || 1; min -= pad; max += pad;
      var pw = W - ML - MR, ph = H - MT - MB;
      function X(i) { return ML + (i - start) / (end - start || 1) * pw; }
      function Y(v) { return MT + (1 - (v - min) / (max - min)) * ph; }

      // 눈금선(가로)
      niceTicks(min, max).forEach(function (t) {
        el('line', { x1: ML, x2: W - MR, y1: Y(t), y2: Y(t), 'class': 'grid' }, svg);
        var tx = el('text', { x: ML - 6, y: Y(t) + 4, 'text-anchor': 'end' }, svg);
        tx.textContent = Math.abs(t) >= 100 ? Math.round(t) : t.toFixed(1);
      });
      // 가로축 눈금(연도 또는 월)
      var ticks = [], span = end - start, monthly = span <= 70;
      for (var i = start; i <= end; i++) {
        var cur = dates[i], prev = i > 0 ? dates[i - 1] : '';
        if (monthly ? cur.slice(0, 7) !== prev.slice(0, 7) : cur.slice(0, 4) !== prev.slice(0, 4))
          ticks.push(i);
      }
      var every = Math.ceil(ticks.length / (monthly ? 6 : 8)) || 1;
      ticks.forEach(function (ti, k) {
        if (k % every) return;
        var label = monthly ? (dates[ti].slice(5, 7) === '01' ? dates[ti].slice(0, 4) + '.' : '') + parseInt(dates[ti].slice(5, 7), 10) + '월'
                            : dates[ti].slice(0, 4);
        el('line', { x1: X(ti), x2: X(ti), y1: MT + ph, y2: MT + ph + 4, 'class': 'axis' }, svg);
        el('text', { x: X(ti), y: H - 8, 'text-anchor': 'middle' }, svg).textContent = label;
      });
      el('line', { x1: ML, x2: W - MR, y1: MT + ph, y2: MT + ph, 'class': 'axis' }, svg);

      // 선
      lines.forEach(function (l) {
        var d = '', pen = false;
        for (var i = start; i <= end; i++) {
          var v = l.data[i];
          if (v == null) { pen = false; continue; }
          d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1);
          pen = true;
        }
        var a = { d: d, fill: 'none', stroke: l.color, 'stroke-width': l.w, 'stroke-linejoin': 'round' };
        if (l.dash) a['stroke-dasharray'] = l.dash;
        el('path', a, svg);
      });

      // 마지막 점과 숫자 표시
      var labels = [];
      lines.forEach(function (l) {
        var p = pick(l.data, end);
        if (!p || p.i < start) return;
        el('circle', { cx: X(p.i), cy: Y(p.v), r: 3.5, fill: l.color }, svg);
        labels.push({ y: Y(p.v), x: X(p.i) + 7, text: p.v.toFixed(2), color: l.color });
      });
      labels.sort(function (a, b) { return a.y - b.y; });
      for (var k = 1; k < labels.length; k++)           // 숫자가 겹치면 아래로 밀기
        if (labels[k].y - labels[k - 1].y < 13) labels[k].y = labels[k - 1].y + 13;
      labels.forEach(function (lb) {
        var t = el('text', { x: lb.x, y: lb.y + 4, fill: lb.color, style: 'font-weight:700;font-size:14px;fill:' + lb.color }, svg);
        t.textContent = lb.text;
      });

      // 마우스 위치 표시(세로선 + 점)
      var cross = el('line', { y1: MT, y2: MT + ph, stroke: '#6b7280', 'stroke-dasharray': '3 3', 'stroke-width': 1 }, svg);
      var dots = lines.map(function (l) { return el('circle', { r: 4, fill: '#fff', stroke: l.color, 'stroke-width': 2 }, svg); });
      var hit = el('rect', { x: ML, y: MT, width: pw, height: ph, fill: 'transparent' }, svg);

      chartCtx = { start: start, end: end, lines: lines, X: X, Y: Y, cross: cross, dots: dots, s: s, nat: nat };

      function showAt(i) {
        i = Math.max(start, Math.min(end, i));
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
        lines.forEach(function (l, j) {
          var v = l.data[i];
          if (v == null) { dots[j].setAttribute('visibility', 'hidden'); return; }
          dots[j].setAttribute('visibility', 'visible');
          dots[j].setAttribute('cx', X(i)); dots[j].setAttribute('cy', Y(v));
        });
        var parts = [fmtDate(dates[i])];
        parts.push('매매 ' + (s.si[i] != null ? s.si[i].toFixed(2) : '-') + ' (' + fmtPct(s.sc[i]) + ')');
        parts.push('전세 ' + (s.ji[i] != null ? s.ji[i].toFixed(2) : '-') + ' (' + fmtPct(s.jc[i]) + ')');
        if (nat) parts.push('전국 매매 ' + (nat.si[i] != null ? nat.si[i].toFixed(2) : '-'));
        $('hover-info').textContent = (state.hover == null ? (i === end ? '마지막 시점 · ' : '선택한 주 · ') : '') + parts.join(' · ');
      }
      chartCtx.showAt = showAt;
      function evIndex(e) {
        var rect = svg.getBoundingClientRect();
        var px = (e.clientX - rect.left) * (W / rect.width);
        return Math.round(start + (px - ML) / pw * (end - start));
      }
      hit.addEventListener('pointermove', function (e) { state.hover = evIndex(e); showAt(state.hover); });
      hit.addEventListener('pointerleave', function () { state.hover = null; showAt(state.week); });
      showAt(state.week);

      var firstValid = 0;
      while (firstValid < n && s.si[firstValid] == null) firstValid++;
      $('chart-base').textContent = '지수 기준: ' + fmtDate(idx.base) + ' = 100' +
        (firstValid > 0 ? ' · 이 지역 자료는 ' + fmtDate(dates[firstValid]) + '부터 있습니다.' : '');
    }).catch(showError);
  }

  // ---------- 이벤트 연결 ----------
  function bindUi() {
    $('m-sc').addEventListener('click', function () { setMetric('sc'); });
    $('m-jc').addEventListener('click', function () { setMetric('jc'); });
    $('sel-sido').addEventListener('change', function (e) {
      var v = e.target.value, r = regions[v];
      if (r.agg || !r.geo || !r.children.length) {
        selectSido(null).then(function () { selectRegion(v); });
      } else {
        selectSido(v).then(function () { selectRegion(v); });
      }
    });
    $('sel-sgg').addEventListener('change', function (e) {
      selectRegion(e.target.value || state.sidoId);
    });
    $('btn-back').addEventListener('click', function () {
      selectSido(null).then(function () { selectRegion('a1'); });
    });
    $('week').addEventListener('input', function (e) {
      state.week = +e.target.value;
      updateTitles(); recolor(); renderRank(); renderStats(); renderChart();
    });
    $('btn-latest').addEventListener('click', function () {
      $('week').value = idx.dates.length - 1;
      $('week').dispatchEvent(new Event('input'));
    });
    $('range').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.range = +b.dataset.w;
      Array.prototype.forEach.call($('range').children, function (c) { c.classList.toggle('on', c === b); });
      renderChart();
    });
    $('cmp').addEventListener('change', function (e) { state.cmp = e.target.checked; renderChart(); });
  }
  function setMetric(m) {
    state.metric = m;
    $('m-sc').classList.toggle('on', m === 'sc');
    $('m-jc').classList.toggle('on', m === 'jc');
    updateTitles(); recolor(); renderRank();
  }

  // ---------- 시작 ----------
  Promise.all([
    fetchJson('data/kb/index.json'), fetchJson('data/kb/map_sido.json'), fetchJson('data/kb/aggregate.json'),
    fetchJson('data/geo_sido.json'), fetchJson('data/geo_sigungu.json')
  ]).then(function (r) {
    idx = r[0]; mapSido = r[1]; aggSeries = r[2]; geoSido = r[3]; geoSgg = r[4];
    buildRegions();
    state.week = idx.dates.length - 1;
    var wk = $('week'); wk.max = state.week; wk.value = state.week;
    $('src-date').textContent = fmtDate(idx.latest);
    fillSidoSelect();
    initMap();
    bindUi();
    fillSggSelect();
    updateTitles();
    recolor();
    renderRank();
    selectRegion('a1');
  }).catch(showError);
})();
