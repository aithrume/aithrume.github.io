/* =========================================================
   chart-core.js - 차트 · 데이터 · URL 상태 · 지역 교차링크 공통 유틸
   ========================================================= */
window.ChartCore = (function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  function $(id) { return document.getElementById(id); }

  function el(name, attrs, parent) {
    var e = document.createElementNS(SVGNS, name);
    if (attrs) {
      for (var k in attrs) e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' (' + r.status + ')');
      return r.json();
    });
  }

  function fmtNum(n) {
    return n == null ? '-' : Math.round(n).toLocaleString('ko-KR');
  }

  function ymDot(m) { return m.slice(0, 4) + '.' + m.slice(4); }
  function ymLabel(m) { return m.slice(0, 4) + '년 ' + parseInt(m.slice(4), 10) + '월'; }

  // 축 눈금 자동 계산 (min/max가 눈금 안에 넉넉히 들어오도록)
  function niceRange(min, max, opts) {
    opts = opts || {};
    var count = opts.count || 5;
    var range = max - min || 1, rough = range / count;
    var mag = Math.pow(10, Math.floor(Math.log(rough) / Math.LN10));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= rough; })[0];
    var lo = Math.floor(min / step - 1e-9) * step;
    var hi = Math.ceil(max / step + 1e-9) * step;
    if (hi - max < step * 0.15) hi += step;
    if (min - lo < step * 0.15 && (min < 0 || opts.padMin)) lo -= step;
    if (opts.clampZero && lo < 0) lo = 0;
    var ticks = [];
    for (var v = lo; v <= hi + 1e-9; v += step) ticks.push(+v.toFixed(4));
    return { min: lo, max: hi, ticks: ticks };
  }

  function bindSeg(id, attr, fn) {
    var btns = document.querySelectorAll('#' + id + ' [data-' + attr + ']');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { x.classList.toggle('on', x === b); });
        fn(b.dataset[attr]);
      });
    });
  }

  // 로딩 상태 표시
  function setLoading(target, on, message) {
    var box = typeof target === 'string' ? $(target) : target;
    if (!box) return;
    box.classList.toggle('is-loading', !!on);
    var banner = box.querySelector('.loading-banner');
    if (on) {
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'loading-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        box.insertBefore(banner, box.firstChild);
      }
      banner.textContent = message || '데이터를 불러오는 중입니다…';
    } else if (banner) {
      banner.remove();
    }
  }

  // URL 쿼리 읽기/쓰기 (페이지 새로고침 없이 주소 갱신)
  function getParams() {
    var out = {};
    if (typeof URLSearchParams === 'undefined') return out;
    new URLSearchParams(location.search).forEach(function (v, k) { out[k] = v; });
    return out;
  }

  function setParams(obj) {
    if (typeof URLSearchParams === 'undefined' || !history.replaceState) return;
    var sp = new URLSearchParams();
    Object.keys(obj).forEach(function (k) {
      if (obj[k] !== null && obj[k] !== undefined && obj[k] !== '') sp.set(k, String(obj[k]));
    });
    var qs = sp.toString();
    var next = location.pathname + (qs ? '?' + qs : '') + (location.hash || '');
    history.replaceState(null, '', next);
  }

  // 시도명 정규화 (페이지 간 지역 교차 이동용)
  var SIDO_NORM = {
    '전국': '전국',
    '서울': '서울', '서울특별시': '서울',
    '부산': '부산', '부산광역시': '부산',
    '대구': '대구', '대구광역시': '대구',
    '인천': '인천', '인천광역시': '인천',
    '광주': '광주', '광주광역시': '광주', '(구)광주광역시': '광주',
    '대전': '대전', '대전광역시': '대전',
    '울산': '울산', '울산광역시': '울산',
    '세종': '세종', '세종특별자치시': '세종',
    '경기': '경기', '경기도': '경기',
    '강원': '강원', '강원도': '강원', '강원특별자치도': '강원',
    '충북': '충북', '충청북도': '충북',
    '충남': '충남', '충청남도': '충남',
    '전북': '전북', '전라북도': '전북', '전북특별자치도': '전북',
    '전남': '전남', '전라남도': '전남', '(구)전라남도': '전남',
    '광주전남': '광주', '광주·전남': '광주', '전남광주': '광주',
    '경북': '경북', '경상북도': '경북',
    '경남': '경남', '경상남도': '경남',
    '제주': '제주', '제주도': '제주', '제주특별자치도': '제주'
  };

  function normSido(name) {
    if (!name) return '';
    var cleaned = String(name).trim();
    return SIDO_NORM[cleaned] || cleaned;
  }

  // 선택 지역에서 다른 분석 페이지로 바로 이동하는 링크 생성
  var CROSS_PAGES = [
    { key: 'kb', label: 'KB 시세', href: 'kb.html' },
    { key: 'trade', label: '실거래', href: 'trade.html' },
    { key: 'supply', label: '공급·미분양', href: 'supply.html' },
    { key: 'foreign', label: '외국인 소유', href: 'foreign.html' },
    { key: 'compare', label: '교차 분석', href: 'compare.html' }
  ];

  function renderCrossLinks(container, currentKey, sidoName, sggName) {
    var box = typeof container === 'string' ? $(container) : container;
    if (!box) return;
    var sido = normSido(sidoName);
    if (!sido) { box.innerHTML = ''; return; }
    var targetLabel = sggName ? (sido + ' ' + sggName) : sido;
    var links = CROSS_PAGES.filter(function (p) { return p.key !== currentKey; }).map(function (p) {
      var q = [];
      if (sido && sido !== '전국') q.push('sido=' + encodeURIComponent(sido));
      if (sggName && p.key !== 'compare') q.push('sgg=' + encodeURIComponent(sggName));
      var url = p.href + (q.length ? '?' + q.join('&') : '');
      return '<a class="cross-pill" href="' + url + '">' + p.label + ' ↗</a>';
    });
    box.innerHTML = '<span class="cross-label">' + targetLabel + ' 다른 지표:</span>' + links.join('');
  }

  return {
    SVGNS: SVGNS,
    $: $,
    el: el,
    fetchJson: fetchJson,
    fmtNum: fmtNum,
    ymDot: ymDot,
    ymLabel: ymLabel,
    niceRange: niceRange,
    bindSeg: bindSeg,
    setLoading: setLoading,
    getParams: getParams,
    setParams: setParams,
    normSido: normSido,
    renderCrossLinks: renderCrossLinks
  };
})();
