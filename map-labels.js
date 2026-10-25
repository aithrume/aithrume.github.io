/* =========================================================
   map-labels.js - KB 시세·실거래 지도에 지역명을 얹어 주는 공통 스크립트
   ---------------------------------------------------------
   - 각 지역 '안쪽에서 경계로부터 가장 먼 지점'에 이름을 놓습니다.
     (경기도처럼 가운데가 서울로 뚫린 모양이어도 이름이 서울 위에 오지 않음)
   - 이름끼리 겹치면 다른 후보 자리로 옮겨 보고, 그래도 자리가 없으면 그 이름은 뺍니다.
     (먼저 놓는 순서: priority 가 높은 것 → 면적이 큰 것)
   - 좌표 변환은 kb.js·trade.js 의 proj() 와 같아야 합니다.
   ========================================================= */
window.MapLabels = (function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var LON0 = 124.5, LAT1 = 38.7, KY = 100, KX = 100 * Math.cos(36 * Math.PI / 180);
  var FONT_PX = 12;                 // 화면에서 보이는 글자 크기(px)

  // 전국 지도에서 쓰는 짧은 시도 이름 (경계 코드 → 이름)
  var SIDO_SHORT = {
    '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주', '25': '대전', '26': '울산',
    '29': '세종', '31': '경기', '32': '강원', '33': '충북', '34': '충남', '35': '전북', '36': '전남',
    '37': '경북', '38': '경남', '39': '제주'
  };

  function xy(p) { return [(p[0] - LON0) * KX, (LAT1 - p[1]) * KY]; }

  function ringArea(r) {
    var a = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
    return Math.abs(a / 2);
  }
  function inside(x, y, rings) {    // 짝수-홀수 규칙 (구멍 포함)
    var c = false;
    rings.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        if ((r[i][1] > y) !== (r[j][1] > y) &&
            x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
      }
    });
    return c;
  }
  function edgeDist(x, y, rings) {  // 가장 가까운 경계선까지 거리
    var best = Infinity;
    rings.forEach(function (r) {
      for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
        var ax = r[j][0], ay = r[j][1], dx = r[i][0] - ax, dy = r[i][1] - ay;
        var t = dx || dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
        var ex = ax + t * dx - x, ey = ay + t * dy - y;
        best = Math.min(best, ex * ex + ey * ey);
      }
    });
    return Math.sqrt(best);
  }

  // 경계(feature) → 이름 놓을 후보 자리들(좋은 순)과 면적. 한 번 계산하면 feature 에 보관
  function anchor(f) {
    if (f._label) return f._label;
    var polys = f.geometry.coordinates.map(function (poly) { return poly.map(function (r) { return r.map(xy); }); });
    var total = 0, main = null, mainA = -1;
    polys.forEach(function (rings) {
      var a = ringArea(rings[0]);
      total += a;
      if (a > mainA) { mainA = a; main = rings; }
    });
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    main[0].forEach(function (p) {
      b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]);
    });
    // 성긴 격자에서 경계와 먼 점들을 모으고, 가장 좋은 점은 주변을 촘촘하게 한 번 더 찾음
    function scan(x0, y0, x1, y1, n) {
      var pts = [];
      for (var i = 0; i <= n; i++) {
        for (var j = 0; j <= n; j++) {
          var x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * j / n;
          if (inside(x, y, main)) pts.push({ x: x, y: y, d: edgeDist(x, y, main) });
        }
      }
      return pts.sort(function (p, q) { return q.d - p.d; });
    }
    var pts = scan(b[0], b[1], b[2], b[3], 20);
    if (!pts.length) pts = [{ x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, d: 0 }];
    var cx = (b[2] - b[0]) / 20, cy = (b[3] - b[1]) / 20;
    var top = scan(pts[0].x - cx, pts[0].y - cy, pts[0].x + cx, pts[0].y + cy, 8)[0] || pts[0];
    // 후보: 가장 좋은 점 + 서로 떨어져 있고 충분히 안쪽인 점 몇 개
    var cands = [top];
    pts.forEach(function (p) {
      if (cands.length >= 6 || p.d < top.d * 0.4) return;
      var far = cands.every(function (c) { return Math.hypot(c.x - p.x, c.y - p.y) > top.d * 0.8; });
      if (far) cands.push(p);
    });
    f._label = { cands: cands, area: total };
    return f._label;
  }

  // 화면 1px 이 지도 좌표로 얼마인지 (viewBox 가 svg 크기에 맞춰 줄어든 비율)
  function unitsPerPx(svg, view) {
    var w = svg.clientWidth || 560, h = svg.clientHeight || 520;
    return Math.max(view[2] / w, view[3] / h);
  }

  /**
   * 지역명 그리기
   *  layer : 이름을 넣을 <g> (기존 내용은 지움)
   *  items : [{ text: '강남구', features: [경계, ...], priority: 0 }]  ← 자료가 있는 지역만 넘기세요
   *  view  : 이동이 끝난 뒤의 viewBox [x, y, w, h]
   */
  function draw(layer, items, view) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    var svg = layer.ownerSVGElement, upp = unitsPerPx(svg, view);
    var fs = FONT_PX * upp, pad = 2 * upp;
    var list = items.map(function (it) {
      var big = null;
      it.features.forEach(function (f) { var a = anchor(f); if (!big || a.area > big.area) big = a; });
      return { text: it.text, a: big, priority: it.priority || 0,
               area: it.features.reduce(function (s, f) { return s + anchor(f).area; }, 0) };
    }).filter(function (x) { return x.a; });
    list.sort(function (p, q) { return (q.priority - p.priority) || (q.area - p.area); });

    var placed = [];
    list.forEach(function (it) {
      var w = it.text.length * fs * 0.95, h = fs * 1.1, spot = null;
      it.a.cands.some(function (c) {                            // 후보 자리를 차례로 시도
        var box = [c.x - w / 2 - pad, c.y - h / 2 - pad, c.x + w / 2 + pad, c.y + h / 2 + pad];
        var hit = placed.some(function (o) { return box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]; });
        if (!hit) spot = { c: c, box: box };
        return !hit;
      });
      if (!spot) return;                                        // 자리가 없으면 이 이름은 생략
      placed.push(spot.box);
      var t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', spot.c.x.toFixed(1));
      t.setAttribute('y', spot.c.y.toFixed(1));
      t.setAttribute('font-size', fs.toFixed(2));
      t.setAttribute('stroke-width', (3 * upp).toFixed(2));
      t.textContent = it.text;
      layer.appendChild(t);
    });
  }

  // 전국 지도에서 이름을 먼저 놓을 특별·광역시 (면적이 작아 도 이름에 밀리지 않도록)
  function sidoPriority(code) { return /^(11|21|22|23|24|25|26|29)$/.test(code) ? 1 : 0; }

  return { draw: draw, SIDO_SHORT: SIDO_SHORT, sidoPriority: sidoPriority };
})();
