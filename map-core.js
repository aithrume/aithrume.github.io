/* =========================================================
   map-core.js - 대한민국 시도·시군구 SVG 지도 공통 유틸
   (kb.js, trade.js, supply.js, foreign.js 공용)
   ========================================================= */
window.MapCore = (function () {
  'use strict';

  var LON0 = 124.5, LAT1 = 38.7, KY = 100;
  var KX = 100 * Math.cos(36 * Math.PI / 180);
  var FULL_VIEW = [0, 0, 607, 570];
  var HIDE_SHAPES = { '23320': '옹진군' };
  var HIDDEN_NOTE = '섬 지역이라 시도 지도를 크게 보이도록 지도에서는 생략했습니다. 목록에서 선택해 확인하세요.';

  function isHidden(name) {
    return Object.keys(HIDE_SHAPES).some(function (c) { return HIDE_SHAPES[c] === name; });
  }

  function proj(p) {
    return ((p[0] - LON0) * KX).toFixed(1) + ',' + ((LAT1 - p[1]) * KY).toFixed(1);
  }

  function pathD(geom) {
    var d = '';
    geom.coordinates.forEach(function (poly) {
      poly.forEach(function (ring) { d += 'M' + ring.map(proj).join('L') + 'Z'; });
    });
    return d;
  }

  // 아주 작은 섬은 무시하고 본토 기준 bounding box 계산
  function bboxOf(features) {
    var polys = [];
    features.forEach(function (f) {
      f.geometry.coordinates.forEach(function (poly) {
        var b = [1e9, 1e9, -1e9, -1e9];
        poly[0].forEach(function (p) {
          var x = (p[0] - LON0) * KX, y = (LAT1 - p[1]) * KY;
          b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y);
          b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y);
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

  function viewForBox(b) {
    var w = b[2] - b[0], h = b[3] - b[1], pad = Math.max(w, h) * 0.08;
    return [b[0] - pad, b[1] - pad, w + pad * 2, h + pad * 2];
  }

  function lerp(a, b, t) {
    return a.map(function (x, i) { return Math.round(x + (b[i] - x) * t); });
  }

  function rgb(c) {
    return 'rgb(' + c.join(',') + ')';
  }

  function showTip(tipEl, e, html) {
    var tip = typeof tipEl === 'string' ? document.getElementById(tipEl) : tipEl;
    if (!tip) return;
    var box = tip.parentNode.getBoundingClientRect();
    tip.innerHTML = html;
    tip.hidden = false;
    var x = e.clientX - box.left + 14, y = e.clientY - box.top + 14;
    if (x + tip.offsetWidth > box.width) x = e.clientX - box.left - tip.offsetWidth - 10;
    if (y + tip.offsetHeight > box.height) y = e.clientY - box.top - tip.offsetHeight - 10;
    tip.style.left = Math.max(0, x) + 'px';
    tip.style.top = Math.max(0, y) + 'px';
  }

  function createViewAnimator(svgEl, initialView) {
    var cur = (initialView || FULL_VIEW).slice();
    var target = cur.slice();
    var animId = 0;

    function set(v) {
      var svg = typeof svgEl === 'string' ? document.getElementById(svgEl) : svgEl;
      if (svg) svg.setAttribute('viewBox', v.map(function (n) { return n.toFixed(1); }).join(' '));
      cur = v.slice();
    }

    function animate(to, duration) {
      var from = cur.slice(), t0 = null, id = ++animId, dur = duration || 350;
      target = to.slice();
      function step(ts) {
        if (id !== animId) return;
        if (t0 === null) t0 = ts;
        var t = Math.min(1, (ts - t0) / dur), e = 1 - Math.pow(1 - t, 3);
        set(from.map(function (f, i) { return f + (to[i] - f) * e; }));
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    return {
      set: set,
      animate: animate,
      getCurrent: function () { return cur; },
      getTarget: function () { return target; }
    };
  }

  return {
    LON0: LON0,
    LAT1: LAT1,
    KY: KY,
    KX: KX,
    FULL_VIEW: FULL_VIEW,
    HIDE_SHAPES: HIDE_SHAPES,
    HIDDEN_NOTE: HIDDEN_NOTE,
    isHidden: isHidden,
    proj: proj,
    pathD: pathD,
    bboxOf: bboxOf,
    viewForBox: viewForBox,
    lerp: lerp,
    rgb: rgb,
    showTip: showTip,
    createViewAnimator: createViewAnimator
  };
})();
