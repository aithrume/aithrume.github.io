/* =========================================================
   trade.js - 아파트 실거래 지도 + 월별 그래프 (외부 라이브러리 없이 SVG로 직접 그림)
   ---------------------------------------------------------
   데이터(data/ 폴더, tools/build_trades.py 가 만들어 줌)
   - trades/months.json     : 있는 달 목록
   - trades/regions.json    : 지역 목록(시도·시군구 구조, 지도 경계 연결)
   - trades/m/YYYYMM.json   : 그 달의 지역별 거래량·가격  (달마다 1개, 전부 불러와 합침)
   - trades/t/YYYYMM.json   : 그 달의 최고가 거래 TOP3     (선택한 달만 필요할 때 불러옴)
   - geo_sido.json / geo_sigungu.json : 지도 경계
   ========================================================= */
(function () {
  'use strict';

  var C = window.ChartCore, M = window.MapCore;
  var $ = C.$, el = C.el, fetchJson = C.fetchJson;

  var FULL_VIEW = M.FULL_VIEW;
  var HIDE_SHAPES = M.HIDE_SHAPES, HIDDEN_NOTE = M.HIDDEN_NOTE, isHidden = M.isHidden;
  var lerp = M.lerp, rgb = M.rgb;
  var pathD = M.pathD, bboxOf = M.bboxOf, viewForBox = M.viewForBox;
  var SEQ_LO = [235, 243, 255], SEQ_HI = [29, 78, 216];
  var MID = [238, 240, 243], UP = [220, 38, 38], DOWN = [37, 99, 235];
  var CHG_RANGE = { n: 30, med: 5, avg: 5, ppm: 5 };       // 전월 대비 색이 가장 진해지는 변화율(%)
  var METRIC_NAME = { n: '거래량', med: '중위 거래가', avg: '평균 거래가', ppm: '3.3㎡당 가격' };
  var PY = 3.3058;                                          // 1평 = 3.3058㎡

  var state = { metric: 'n', mode: 'val', m: 0, sidoId: null, regionId: '전국', cmp: true };
  var D, regions = {}, sidos = [], geoSido, geoSgg;
  var topCache = {};                 // 달 → 최고가 거래 (불러온 것만)
  var sidoPaths = {}, sggPaths = [], sggByCode = {}, shapeOwner = {};
  var gS, gG, gL, curView = FULL_VIEW.slice(), viewAnim = 0, drillToken = 0;
  var targetView = FULL_VIEW.slice();   // 이동이 끝난 뒤의 화면 (지역명 크기 계산용)

  // ---------- 도구 ----------
  function ymLabel(m) { return C.ymLabel(m); }
  function ymDot(m) { return C.ymDot(m); }

  function fmtNum(n) { return Math.round(n).toLocaleString('ko-KR'); }
  function fmtPrice(v) {                       // 만원 → '8.7억' / '7,500만'
    if (v == null) return '-';
    if (v >= 10000) return (Math.round(v / 100) / 100) + '억';
    return fmtNum(v) + '만';
  }
  function fmtPriceAxis(v) {
    if (v >= 10000) return (Math.round(v / 1000) / 10) + '억';
    return fmtNum(v) + '만';
  }
  function fmtPy(v) { return v == null ? '-' : fmtNum(v * PY) + '만'; }   // 만원/㎡ → 만원/평
  function fmtPct(v, digits) {
    if (v == null) return '-';
    return (v > 0 ? '+' : '') + v.toFixed(digits == null ? 1 : digits) + '%';
  }
  function fmtMetric(metric, v) {
    if (v == null) return '-';
    if (metric === 'n') return fmtNum(v) + '건';
    if (metric === 'ppm') return fmtPy(v);
    return fmtPrice(v);
  }

  // ---------- 값 계산 ----------
  function rawAt(rid, metric, i) {
    var s = D.data[rid];
    if (!s || i < 0 || i >= D.months.length) return null;
    if (metric === 'n') return s.n[i];
    if (s.n[i] < D.minN) return null;           // 거래가 너무 적으면 가격은 숨김
    return s[metric][i];
  }
  function changePct(rid, metric, i, back) {
    var cur = rawAt(rid, metric, i), prev = rawAt(rid, metric, i - back);
    if (cur == null || prev == null || prev === 0) return null;
    return (cur - prev) / prev * 100;
  }
  function shown(rid) {                          // 지도·순위에 표시할 값
    return state.mode === 'val' ? rawAt(rid, state.metric, state.m) : changePct(rid, state.metric, state.m, 1);
  }
  function fmtShown(v) {
    if (v == null) return '-';
    return state.mode === 'val' ? fmtMetric(state.metric, v) : fmtPct(v, 1);
  }

  // ---------- 색칠 ----------
  function colorMap(rids) {
    var vals = rids.map(function (r) { return { r: r, v: shown(r) }; });
    var out = {}, nums = vals.filter(function (x) { return x.v != null; }).map(function (x) { return x.v; });
    if (state.mode === 'chg') {
      var R = CHG_RANGE[state.metric];
      vals.forEach(function (x) {
        if (x.v == null) { out[x.r] = null; return; }
        var t = Math.max(-1, Math.min(1, x.v / R));
        out[x.r] = rgb(lerp(MID, t >= 0 ? UP : DOWN, Math.abs(t)));
      });
      setLegend(false, '-' + R + '%', '+' + R + '%');
    } else {
      var sorted = nums.slice().sort(function (a, b) { return a - b; });
      vals.forEach(function (x) {
        if (x.v == null) { out[x.r] = null; return; }
        var t = sorted.length > 1 ? sorted.indexOf(x.v) / (sorted.length - 1) : 0.5;   // 순위 기준 색
        out[x.r] = rgb(lerp(SEQ_LO, SEQ_HI, t));
      });
      setLegend(true, sorted.length ? '낮음 ' + fmtMetric(state.metric, sorted[0]) : '낮음',
                       sorted.length ? '높음 ' + fmtMetric(state.metric, sorted[sorted.length - 1]) : '높음');
    }
    return out;
  }
  function setLegend(seq, lo, hi) {
    $('lg-bar').className = 'legend-bar' + (seq ? ' seq' : '');
    $('lg-min').textContent = lo; $('lg-max').textContent = hi;
  }

  // ---------- 지도 ----------
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
  function showTip(e, html) { M.showTip('map-tip', e, html); }
  function hideTip() { $('map-tip').hidden = true; }
  function tipHtml(rid) {
    if (!rid) return '거래 자료 없음';
    var r = regions[rid], s = D.data[rid];
    var line = state.mode === 'val' ? METRIC_NAME[state.metric] + ' ' + fmtShown(shown(rid))
                                    : METRIC_NAME[state.metric] + ' 전월 대비 ' + fmtShown(shown(rid));
    return '<strong>' + displayName(r) + '</strong><br>' + line + '<br>거래 ' + fmtNum(s.n[state.m]) + '건';
  }
  function displayName(r) {
    if (r.level === 3) return regions[r.parent].name + ' ' + r.name;
    if (r.group) return r.sido.replace(/특별시|광역시/, '') + ' ' + r.name;
    return r.name;
  }

  function bindShape(path, ridFn, nameFn, onClick) {
    path.addEventListener('pointermove', function (e) {
      var rid = ridFn();
      showTip(e, rid ? tipHtml(rid) : '<strong>' + nameFn() + '</strong><br>거래 자료 없음');
    });
    path.addEventListener('pointerleave', hideTip);
    path.addEventListener('click', onClick);
  }

  function initMap() {
    var svg = $('kb-map');
    gS = el('g', {}, svg);
    gG = el('g', {}, svg);
    gL = el('g', { 'class': 'map-labels' }, svg);   // 지역명 (맨 위)
    var byGeo = {};
    sidos.forEach(function (r) { if (r.geo) byGeo[r.geo] = r.id; });
    geoSido.features.forEach(function (f) {
      var rid = byGeo[f.properties.code];
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gS);
      p.dataset.rid = rid || '';
      p.feature = f;
      sidoPaths[f.properties.code] = p;
      bindShape(p, function () { return rid; }, function () { return f.properties.name; },
                function () { if (rid) onSidoClick(rid); });
    });
    // 각 경계 코드가 어느 시도에 속하는지 (군위군처럼 2018년과 소속이 바뀐 곳 처리)
    D.regions.forEach(function (r) { (r.shapes || []).forEach(function (c) { shapeOwner[c] = r.sido; }); });
  }

  function buildSggLayer(sidoId) {
    while (gG.firstChild) gG.removeChild(gG.firstChild);
    sggPaths = []; sggByCode = {};
    var s = regions[sidoId], codeMap = {};
    var cand = D.regions.filter(function (r) { return r.sido === sidoId && r.level >= 2; });
    function put(r) { (r.shapes || []).forEach(function (c) { codeMap[c] = r.id; }); }
    cand.filter(function (r) { return r.level === 2 && !r.group; }).forEach(put);   // 시·군
    cand.filter(function (r) { return r.level === 3; }).forEach(put);               // 구 (시보다 우선)
    cand.filter(function (r) { return r.group; }).forEach(put);                      // 개편 전 구역 묶음
    geoSgg.features.forEach(function (f) {
      var code = f.properties.code, rid = codeMap[code] || null;
      if (HIDE_SHAPES[code]) return;
      if (!rid && (shapeOwner[code] || code.slice(0, 2) !== s.geo)) return;
      var p = el('path', { d: pathD(f.geometry), 'fill-rule': 'evenodd', fill: '#e5e7eb' }, gG);
      p.dataset.rid = rid || ''; p.dataset.code = code; p.feature = f;
      if (!rid) p.classList.add('nodata');
      bindShape(p, function () { return rid; }, function () { return f.properties.name; },
                function () { if (rid) selectRegion(rid); });
      sggPaths.push(p); sggByCode[code] = p;
    });
  }

  function recolor() {
    var rids = [], seen = {};
    var m;
    if (state.sidoId == null) {
      sidos.forEach(function (r) { if (r.geo) rids.push(r.id); });
      m = colorMap(rids);
      Object.keys(sidoPaths).forEach(function (code) {
        var p = sidoPaths[code], c = p.dataset.rid ? m[p.dataset.rid] : null;
        p.setAttribute('fill', c || '#e5e7eb');
      });
    } else {
      sggPaths.forEach(function (p) { var r = p.dataset.rid; if (r && !seen[r]) { seen[r] = 1; rids.push(r); } });
      m = colorMap(rids);
      sggPaths.forEach(function (p) {
        var c = p.dataset.rid ? m[p.dataset.rid] : null;
        p.setAttribute('fill', c || '#e5e7eb');
      });
    }
    renderLabels();
  }

  // 지역명: 전국이면 시도, 시도 안이면 시군구. 이 달 값이 없는 지역(거래 없음 등)은 이름도 생략
  function renderLabels() {
    var byRid = {};
    var paths = state.sidoId == null ? Object.keys(sidoPaths).map(function (c) { return sidoPaths[c]; }) : sggPaths;
    paths.forEach(function (p) {
      var rid = p.dataset.rid;
      if (!rid || shown(rid) == null) return;
      var code = p.feature.properties.code, nat = state.sidoId == null;
      var text = nat ? MapLabels.SIDO_SHORT[code] || regions[rid].name : regions[rid].name;
      (byRid[rid] = byRid[rid] || { text: text, features: [], priority: nat ? MapLabels.sidoPriority(code) : 0 }).features.push(p.feature);
    });
    MapLabels.draw(gL, Object.keys(byRid).map(function (k) { return byRid[k]; }), targetView);
  }

  function shapesFor(rid) {
    var r = regions[rid], out = [];
    if (!r) return out;
    if (r.level === 1) {
      if (state.sidoId == null && r.geo && sidoPaths[r.geo]) out.push(sidoPaths[r.geo]);
      return out;
    }
    var codes = r.shapes || [];
    if (!codes.length && r.level === 3) codes = regions[r.parent].shapes || [];
    codes.forEach(function (c) { if (sggByCode[c]) out.push(sggByCode[c]); });
    return out;
  }
  function highlight() {
    Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.remove('sel'); });
    sggPaths.forEach(function (p) { p.classList.remove('sel'); });
    shapesFor(state.regionId).forEach(function (p) { p.classList.add('sel'); });
  }

  // ---------- 선택 ----------
  function hasChildren(id) {
    return D.regions.some(function (r) { return r.sido === id && r.level >= 2; });
  }
  function onSidoClick(rid) {
    if (state.sidoId === rid) { selectRegion(rid); return; }
    selectSido(rid).then(function () { selectRegion(rid); });
  }
  function selectSido(sidoId) {
    var tok = ++drillToken, s = sidoId ? regions[sidoId] : null;
    if (!s || !s.geo || !hasChildren(sidoId)) {
      state.sidoId = null;
      while (gG.firstChild) gG.removeChild(gG.firstChild);
      sggPaths = []; sggByCode = {};
      Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.remove('dim'); });
      animateView(FULL_VIEW);
      afterDrill();
      return Promise.resolve();
    }
    if (tok !== drillToken) return Promise.resolve();
    state.sidoId = sidoId;
    buildSggLayer(sidoId);
    Object.keys(sidoPaths).forEach(function (c) { sidoPaths[c].classList.toggle('dim', sidoPaths[c].dataset.rid !== sidoId); });
    animateView(viewForBox(bboxOf(sggPaths.map(function (p) { return featByCode[p.dataset.code]; }))));
    afterDrill();
    return Promise.resolve();
  }
  var featByCode = {};

  function afterDrill() {
    fillSggSelect(); syncSelects(); updateTitles(); recolor(); highlight(); renderRank();
    $('btn-back').hidden = state.sidoId == null;
  }
  function selectRegion(rid) {
    state.regionId = rid;
    syncSelects(); highlight(); renderRank(); renderStats(); renderChart(); renderTop();
    $('cmp').disabled = rid === '전국';
    var r = regions[rid];
    var sido = r.level === 0 ? (r.id === '전국' ? '전국' : '') : (r.sido || r.id);
    var sgg = r.level >= 2 ? displayName(r) : null;
    C.renderCrossLinks('cross-links', 'trade', sido, sgg);
    C.setParams({
      sido: sido && sido !== '전국' ? C.normSido(sido) : null,
      sgg: sgg || null,
      metric: state.metric === 'n' ? null : state.metric,
      mode: state.mode === 'val' ? null : state.mode
    });
  }
  function setMonth(i) {
    state.m = Math.max(0, Math.min(D.months.length - 1, i));
    $('month').value = state.m;
    updateTitles(); recolor(); renderRank(); renderStats(); renderChart(); renderTop();
  }

  // ---------- 선택 상자 ----------
  function fillSidoSelect() {
    var h = '<optgroup label="전국·권역">';
    regions['전국'] && (h += '<option value="전국">전국</option>');
    regions['수도권'] && (h += '<option value="수도권">수도권 (서울·인천·경기)</option>');
    h += '</optgroup><optgroup label="시도">';
    sidos.forEach(function (r) {
      var label = r.total ? r.name + ' (광주+전남 합산)' : r.name;
      h += '<option value="' + r.id + '">' + label + '</option>';
    });
    $('sel-sido').innerHTML = h + '</optgroup>';
  }
  function fillSggSelect() {
    var sel = $('sel-sgg');
    var r0 = regions[state.regionId], sd = r0 && r0.sido ? r0.sido : null;
    if (!state.sidoId) {
      sel.innerHTML = '<option value="">' + (sd && hasChildren(sd) ? '(시도 전체)' : '시도를 먼저 선택') + '</option>';
      sel.disabled = true; return;
    }
    var h = '<option value="">(시도 전체)</option>';
    D.regions.forEach(function (r) {
      if (r.sido !== state.sidoId || r.level < 2) return;
      var label = r.level === 3 ? '  └ ' + r.name : r.group ? r.name + ' (개편 전 구역 합산)' : r.name;
      h += '<option value="' + r.id + '">' + label + '</option>';
    });
    sel.innerHTML = h; sel.disabled = false;
  }
  function syncSelects() {
    var r = regions[state.regionId];
    $('sel-sido').value = r.level === 0 ? r.id : r.sido;
    $('sel-sgg').value = (state.sidoId && r.sido === state.sidoId && r.level >= 2) ? r.id : '';
  }
  function updateTitles() {
    var area = state.sidoId ? regions[state.sidoId].name + ' 시군구별' : '전국 시도별';
    var what = METRIC_NAME[state.metric] + (state.mode === 'chg' ? ' 전월 대비' : '');
    $('map-title').textContent = area + ' ' + what + ' (' + ymLabel(D.months[state.m]) + ')';
    $('rank-title').textContent = (state.sidoId ? '시군구별' : '시도별') + ' ' + what + ' 순위';
    $('month-label').textContent = ymLabel(D.months[state.m]);
    $('prov-note').hidden = D.provisional.indexOf(D.months[state.m]) < 0;
  }

  // ---------- 순위 ----------
  function renderRank() {
    var items = [];
    if (state.sidoId == null) {
      sidos.forEach(function (r) { if (r.geo) items.push(r.id); });
    } else {
      D.regions.forEach(function (r) { if (r.sido === state.sidoId && r.level >= 2) items.push(r.id); });
    }
    var rows = items.map(function (id) { return { id: id, v: shown(id) }; });
    rows.sort(function (a, b) { return a.v == null ? 1 : b.v == null ? -1 : b.v - a.v; });
    var max = Math.max.apply(null, rows.map(function (x) { return x.v == null ? 0 : Math.abs(x.v); }).concat([1e-9]));
    var ol = $('rank'); ol.innerHTML = '';
    rows.forEach(function (it) {
      var r = regions[it.id], li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      if (it.id === state.regionId) b.className = 'on';
      var w = it.v == null ? 0 : Math.abs(it.v) / max * 100, bar = '';
      if (it.v != null) {
        if (state.mode === 'val') bar = '<i style="left:0;background:#2563eb;width:' + w + '%"></i>';
        else bar = '<i style="' + (it.v >= 0 ? 'left:50%;background:#dc2626;' : 'right:50%;background:#2563eb;') + 'width:' + (w / 2) + '%"></i>';
      }
      var label = displayName(r) + (r.group ? '<span class="tag">개편 전 구역</span>' : '') +
                  (rawAt(it.id, 'med', state.m) == null && state.metric !== 'n' && state.mode === 'val' ? '<span class="tag">표본 적음</span>' : '');
      b.innerHTML = '<span>' + label + '</span><span class="bar' + (state.mode === 'val' ? ' left' : '') + '">' + bar +
        '</span><span class="num ' + (state.mode === 'chg' ? (it.v > 0 ? 'up' : it.v < 0 ? 'down' : '') : '') + '">' + fmtShown(it.v) + '</span>';
      b.addEventListener('click', function () {
        if (state.sidoId == null) onSidoClick(it.id); else selectRegion(it.id);
      });
      li.appendChild(b); ol.appendChild(li);
    });
  }

  // ---------- 숫자 카드 ----------
  function chgSpan(label, v) {
    if (v == null) return '<span class="muted">' + label + ' -</span>';
    var arrow = v > 0 ? '▲ ' : v < 0 ? '▼ ' : '– ';
    return '<span class="' + (v > 0 ? 'up' : v < 0 ? 'down' : '') + '">' + label + ' ' + arrow + Math.abs(v).toFixed(1) + '%</span>';
  }
  function renderStats() {
    var rid = state.regionId, r = regions[rid], s = D.data[rid], i = state.m, notes = [];
    $('region-name').textContent = displayName(r);
    $('region-date').textContent = ymLabel(D.months[i]) + (D.provisional.indexOf(D.months[i]) >= 0 ? ' (집계중)' : '');
    ['n', 'med', 'avg', 'ppm'].forEach(function (k) {
      var v = rawAt(rid, k, i);
      $('v-' + k).textContent = v == null ? '-' : (k === 'n' ? fmtNum(v) + '건' : k === 'ppm' ? fmtPy(v) : fmtPrice(v));
      $('c-' + k).innerHTML = chgSpan('전월', changePct(rid, k, i, 1)) + chgSpan('전년 동월', changePct(rid, k, i, 12));
    });
    if (r.total) notes.push('광주광역시와 전라남도를 합친 값입니다. 지도에는 두 지역이 나뉘어 표시됩니다.');
    if (r.note) notes.push(r.note + ' 기준입니다.');
    if (r.group) notes.push('2026.7 개편 이전 구역에 해당하는 ' + r.members.map(function (m) { return regions[m].name; }).join('+') + ' 합산값입니다.');
    if (r.level >= 2 && isHidden(r.name))
      notes.push(r.name + '은 ' + HIDDEN_NOTE);
    else if (r.level >= 2 && !r.group && shapesFor(rid).length === 0 && state.sidoId === r.sido)
      notes.push('2018년 지도 경계에는 없는 지역이라 지도에 칠해지지 않습니다. 목록에서 선택해 확인하세요.');
    if (s.n[i] < D.minN && s.n[i] > 0) notes.push('이 달 거래가 ' + D.minN + '건 미만이라 가격 통계를 숨겼습니다.');
    if (s.n[i] === 0) notes.push('이 달에는 거래가 없습니다.');
    $('region-note').textContent = notes.join(' ');
  }

  // ---------- 최고가 거래 ----------
  function loadTop(mk) {
    if (!topCache[mk]) {
      topCache[mk] = fetchJson('data/trades/t/' + mk + '.json').catch(function () { return {}; });
    }
    return topCache[mk];
  }
  function renderTop() {
    var ol = $('top-list'), rid = state.regionId, mk = D.months[state.m];
    ol.innerHTML = '<li class="muted small">불러오는 중…</li>';
    loadTop(mk).then(function (t) {
      if (mk !== D.months[state.m] || rid !== state.regionId) return;   // 그 사이 다른 걸 골랐으면 무시
      var list = t[rid] || [];
      if (!list.length) { ol.innerHTML = '<li class="muted small">이 달 거래 자료가 없습니다.</li>'; return; }
      ol.innerHTML = list.map(function (x, k) {
        var date = parseInt(mk.slice(4), 10) + '월 ' + parseInt(x[4], 10) + '일';
        return '<li><span><strong>' + (k + 1) + '. ' + x[1] + '</strong></span><span class="price">' + fmtPrice(x[0]) + '</span>' +
          '<span class="sub">전용 ' + x[2] + '㎡ · ' + x[3] + '층 · ' + date + ' 계약</span></li>';
      }).join('');
    });
  }

  // ---------- 그래프 ----------
  var W = 720, H = 360, ML = 56, MR = 70, P1T = 14, P1B = 196, P2T = 224, P2B = 318;

  function niceTicks(min, max) {
    var range = max - min || 1, rough = range / 4;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var t = [];
    for (var v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) t.push(v);
    return t;
  }

  function renderChart() {
    var rid = state.regionId, s = D.data[rid], M = D.months.length;
    var nat = (state.cmp && rid !== '전국') ? D.data['전국'] : null;
    var svg = $('kb-chart'); svg.innerHTML = '';
    var pw = W - ML - MR;
    function X(i) { return ML + (i + 0.5) / M * pw; }

    var lines = [
      { name: '중위', color: '#2563eb', data: s.med, w: 2.4 },
      { name: '평균', color: '#f59e0b', data: s.avg, w: 2.4 }
    ];
    if (nat) lines.push({ name: '전국 중위', color: '#9ca3af', data: nat.med, w: 1.6, dash: '4 3' });
    var min = 1e12, max = -1e12;
    lines.forEach(function (l) { l.data.forEach(function (v) { if (v != null) { if (v < min) min = v; if (v > max) max = v; } }); });
    if (min > max) { min = 0; max = 1; }
    var pad = (max - min) * 0.08 || 1; min = Math.max(0, min - pad); max += pad;
    function Y1(v) { return P1T + (1 - (v - min) / (max - min)) * (P1B - P1T); }
    var maxN = Math.max.apply(null, s.n.concat([1]));
    function Y2(v) { return P2B - v / maxN * (P2B - P2T); }

    // 선택 월 배경띠
    var bw = pw / M;
    el('rect', { x: X(state.m) - bw / 2, y: P1T, width: bw, height: P2B - P1T, 'class': 'sel-band' }, svg);

    // 가격 패널 눈금
    niceTicks(min, max).forEach(function (t) {
      el('line', { x1: ML, x2: W - MR, y1: Y1(t), y2: Y1(t), 'class': 'grid' }, svg);
      el('text', { x: ML - 6, y: Y1(t) + 4, 'text-anchor': 'end' }, svg).textContent = fmtPriceAxis(t);
    });
    // 거래량 패널
    el('line', { x1: ML, x2: W - MR, y1: P2B, y2: P2B, 'class': 'axis' }, svg);
    el('text', { x: ML - 6, y: P2B + 4, 'text-anchor': 'end' }, svg).textContent = '0';
    el('text', { x: ML - 6, y: P2T + 10, 'text-anchor': 'end' }, svg).textContent = fmtNum(maxN);
    s.n.forEach(function (v, i) {
      if (!v) return;
      var prov = D.provisional.indexOf(D.months[i]) >= 0;
      el('rect', { x: X(i) - bw * 0.35, y: Y2(v), width: bw * 0.7, height: P2B - Y2(v), 'class': 'bar' + (prov ? ' prov' : ''), rx: 2 }, svg);
    });
    // 가로 눈금(월)
    D.months.forEach(function (m, i) {
      if (i % 3 !== (M - 1) % 3) return;
      el('text', { x: X(i), y: H - 22, 'text-anchor': 'middle' }, svg).textContent = m.slice(2, 4) + '.' + m.slice(4);
    });

    // 가격 선
    var labels = [];
    lines.forEach(function (l) {
      var d = '', pen = false, lastI = -1;
      l.data.forEach(function (v, i) {
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y1(v).toFixed(1); pen = true; lastI = i;
      });
      var a = { d: d, fill: 'none', stroke: l.color, 'stroke-width': l.w, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
      if (l.dash) a['stroke-dasharray'] = l.dash;
      el('path', a, svg);
      l.data.forEach(function (v, i) { if (v != null) el('circle', { cx: X(i), cy: Y1(v), r: 2.4, fill: l.color }, svg); });
      if (lastI >= 0 && !l.dash) labels.push({ y: Y1(l.data[lastI]), x: X(lastI) + 8, text: fmtPrice(l.data[lastI]), color: l.color });
    });
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var k = 1; k < labels.length; k++) if (labels[k].y - labels[k - 1].y < 14) labels[k].y = labels[k - 1].y + 14;
    labels.forEach(function (lb) {
      el('text', { x: lb.x, y: lb.y + 4, style: 'font-weight:700;font-size:14px;fill:' + lb.color }, svg).textContent = lb.text;
    });

    // 마우스 올리면 세로선 + 정보, 누르면 그 달로 이동
    var cross = el('line', { y1: P1T, y2: P2B, stroke: '#6b7280', 'stroke-dasharray': '3 3', 'stroke-width': 1, visibility: 'hidden' }, svg);
    var hit = el('rect', { x: ML, y: P1T, width: pw, height: P2B - P1T, fill: 'transparent', style: 'cursor:pointer' }, svg);
    function idxOf(e) {
      var rect = svg.getBoundingClientRect(), px = (e.clientX - rect.left) * (W / rect.width);
      return Math.max(0, Math.min(M - 1, Math.floor((px - ML) / pw * M)));
    }
    function info(i) {
      var mk = D.months[i], prov = D.provisional.indexOf(mk) >= 0;
      var parts = [ymDot(mk) + (prov ? ' (집계중)' : ''), '거래 ' + fmtNum(s.n[i]) + '건'];
      if (s.n[i] >= D.minN) parts.push('중위 ' + fmtPrice(s.med[i]), '평균 ' + fmtPrice(s.avg[i]), '3.3㎡당 ' + fmtPy(s.ppm[i]));
      if (nat && nat.med[i] != null) parts.push('전국 중위 ' + fmtPrice(nat.med[i]));
      $('hover-info').textContent = parts.join(' · ');
    }
    hit.addEventListener('pointermove', function (e) {
      var i = idxOf(e); cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible'); info(i);
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); info(state.m); });
    hit.addEventListener('click', function (e) { setMonth(idxOf(e)); });
    info(state.m);
  }

  // ---------- 이벤트 ----------
  function bindUi() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-metric]'), function (b) {
      b.addEventListener('click', function () {
        state.metric = b.dataset.metric;
        Array.prototype.forEach.call(document.querySelectorAll('[data-metric]'), function (c) { c.classList.toggle('on', c === b); });
        updateTitles(); recolor(); renderRank();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (b) {
      b.addEventListener('click', function () {
        state.mode = b.dataset.mode;
        Array.prototype.forEach.call(document.querySelectorAll('[data-mode]'), function (c) { c.classList.toggle('on', c === b); });
        updateTitles(); recolor(); renderRank();
      });
    });
    $('sel-sido').addEventListener('change', function (e) {
      var v = e.target.value, r = regions[v];
      if (r.level === 0 || !r.geo || !hasChildren(v)) selectSido(null).then(function () { selectRegion(v); });
      else selectSido(v).then(function () { selectRegion(v); });
    });
    $('sel-sgg').addEventListener('change', function (e) { selectRegion(e.target.value || state.sidoId); });
    $('btn-back').addEventListener('click', function () { selectSido(null).then(function () { selectRegion('전국'); }); });
    $('month').addEventListener('input', function (e) { setMonth(+e.target.value); });
    $('btn-latest').addEventListener('click', function () { setMonth(D.months.length - 1); });
    $('cmp').addEventListener('change', function (e) { state.cmp = e.target.checked; renderChart(); });
  }

  function showError(e) {
    console.error(e);
    $('region-note').textContent = '데이터를 불러오지 못했습니다. (' + e.message + ') 로컬에서는 http 서버로 열어야 합니다.';
  }

  // ---------- 시작 ----------
  // 번들(m_bundle.json) 1회 요청으로 모든 달을 불러오고, 없을 때만 월별 파일(m/*.json) fallback
  function loadTrades() {
    return Promise.all([
      fetchJson('data/trades/months.json'),
      fetchJson('data/trades/regions.json'),
      fetchJson('data/trades/m_bundle.json').catch(function () { return null; })
    ]).then(function (r) {
      var months = r[0].months, regMeta = r[1], bundle = r[2];
      var filesPromise = bundle
        ? Promise.resolve(months.map(function (m) { return bundle[m] || null; }))
        : Promise.all(months.map(function (m) {
            return fetchJson('data/trades/m/' + m + '.json').catch(function () { return null; });
          }));
      return filesPromise.then(function (files) {
        var D = { months: months, minN: regMeta.minN, regions: regMeta.regions, data: {}, provisional: [] };
        D.regions.forEach(function (reg) {
          D.data[reg.id] = { n: [], med: [], avg: [], ppm: [], mx: [] };
        });
        files.forEach(function (f, i) {
          var m = months[i];
          D.regions.forEach(function (reg) {
            var v = f && f.keys[reg.id], s = D.data[reg.id];
            s.n.push(v ? v[0] : 0);
            s.med.push(v ? v[1] : null); s.avg.push(v ? v[2] : null);
            s.ppm.push(v ? v[3] : null); s.mx.push(v ? v[4] : null);
          });
          // 신고 기한(계약 후 30일)이 데이터를 받은 날짜까지 안 지났으면 '집계중'
          if (f && f.asof) {
            var y = +m.slice(0, 4), mo = +m.slice(4);
            var end = new Date(Date.UTC(y, mo, 0)).getTime() + 30 * 86400000;
            if (end > Date.parse(f.asof)) D.provisional.push(m);
          }
        });
        return D;
      });
    });
  }

  function applyUrlStart() {
    var p = C.getParams();
    if (p.metric && METRIC_NAME[p.metric]) {
      state.metric = p.metric;
      document.querySelectorAll('[data-metric]').forEach(function (b) { b.classList.toggle('on', b.dataset.metric === state.metric); });
    }
    if (p.mode && (p.mode === 'val' || p.mode === 'chg')) {
      state.mode = p.mode;
      document.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === state.mode); });
    }
    if (p.sido) {
      var want = C.normSido(p.sido);
      var hitSido = sidos.filter(function (s) { return C.normSido(s.id) === want; })[0];
      if (hitSido) {
        return selectSido(hitSido.id).then(function () {
          var targetId = hitSido.id;
          if (p.sgg) {
            var q = p.sgg.replace(/\s+/g, '');
            var hitSgg = D.regions.filter(function (r) {
              return r.sido === hitSido.id && r.level >= 2 &&
                (displayName(r).replace(/\s+/g, '') === q || r.name.replace(/\s+/g, '') === q);
            })[0];
            if (hitSgg) targetId = hitSgg.id;
          }
          selectRegion(targetId);
        });
      }
    }
    selectRegion('전국');
    return Promise.resolve();
  }

  var wrap = document.querySelector('.kb-wrap');
  C.setLoading(wrap, true, '아파트 실거래 데이터를 불러오는 중입니다…');
  Promise.all([loadTrades(), fetchJson('data/geo_sido.json'), fetchJson('data/geo_sigungu.json')])
    .then(function (r) {
      D = r[0]; geoSido = r[1]; geoSgg = r[2];
      D.regions.forEach(function (x) { regions[x.id] = x; if (x.level === 1) sidos.push(x); });
      geoSgg.features.forEach(function (f) { featByCode[f.properties.code] = f; });
      state.m = D.months.length - 1;
      var mo = $('month'); mo.max = state.m; mo.value = state.m;
      $('period').textContent = ymDot(D.months[0]) + ' ~ ' + ymDot(D.months[D.months.length - 1]);
      fillSidoSelect(); initMap(); bindUi(); fillSggSelect();
      updateTitles(); recolor(); renderRank();
      return applyUrlStart();
    })
    .then(function () { C.setLoading(wrap, false); })
    .catch(function (e) { C.setLoading(wrap, false); showError(e); });
})();
