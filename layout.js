/* =========================================================
   layout.js - 전 페이지 공통 상단 메뉴(드롭다운) · 푸터
   ========================================================= */
(function () {
  'use strict';

  var NAV = [
    {
      label: '경제 지표',
      items: [
        { label: 'GDP 성장률', href: 'gdp.html', page: 'gdp.html' },
        { label: '금리 추이', href: 'rates.html', page: 'rates.html' },
        { label: '주요국 정책금리', href: 'rates.html#policy', page: 'rates.html#policy' },
        { label: '주택 공급·미분양', href: 'supply.html', page: 'supply.html' }
      ]
    },
    {
      label: '부동산 지도',
      items: [
        { label: 'KB 주간 아파트 시세', href: 'kb.html', page: 'kb.html' },
        { label: '아파트 실거래 지도', href: 'trade.html', page: 'trade.html' },
        { label: '외국인 주택 소유', href: 'foreign.html', page: 'foreign.html' }
      ]
    },
    { label: '교차 분석', href: 'compare.html', page: 'compare.html' },
    {
      label: '취미생활',
      items: [
        { label: '등산 GPX 기록', href: 'hiking.html', page: 'hiking.html' },
        { label: '여행 지도', href: 'travel.html', page: 'travel.html' },
        { label: '게임', href: 'games.html', page: 'games.html' }
      ]
    }
  ];

  function currentPage() {
    var path = (location.pathname || '').split('/').pop();
    return path || 'index.html';
  }

  function isItemActive(item, page, hash) {
    if (item.page.indexOf('#') >= 0) {
      return (page + hash) === item.page;
    }
    if (item.page === 'rates.html' && hash === '#policy') return false;
    return page === item.page;
  }

  function renderHeader() {
    var header = document.getElementById('site-header');
    if (!header) return;
    var page = currentPage();
    var hash = location.hash || '';
    var logoHref = page === 'index.html' ? '#top' : 'index.html';

    var navHtml = NAV.map(function (entry, idx) {
      if (!entry.items) {
        var active = page === entry.page;
        return '<li class="nav-item"><a href="' + entry.href + '" class="nav-link' + (active ? ' active' : '') + '"' +
          (active ? ' aria-current="page"' : '') + '>' + entry.label + '</a></li>';
      }
      var groupActive = entry.items.some(function (it) { return isItemActive(it, page, hash); });
      var menuId = 'nav-menu-' + idx;
      var itemsHtml = entry.items.map(function (it) {
        var on = isItemActive(it, page, hash);
        return '<a href="' + it.href + '" class="nav-drop-link' + (on ? ' active' : '') + '"' +
          (on ? ' aria-current="page"' : '') + '>' + it.label + '</a>';
      }).join('');
      return (
        '<li class="nav-item nav-drop">' +
        '  <button type="button" class="nav-drop-btn' + (groupActive ? ' active' : '') + '" aria-expanded="false" aria-controls="' + menuId + '">' +
             entry.label + ' <span class="nav-caret" aria-hidden="true">▾</span>' +
        '  </button>' +
        '  <div class="nav-drop-menu" id="' + menuId + '" hidden>' + itemsHtml + '</div>' +
        '</li>'
      );
    }).join('');

    header.innerHTML =
      '<div class="container header-inner">' +
      '  <a href="' + logoHref + '" class="logo">My Portfolio</a>' +
      '  <nav aria-label="주 메뉴"><ul class="nav-list">' + navHtml + '</ul></nav>' +
      '</div>';

    var drops = header.querySelectorAll('.nav-drop');
    function closeAll(except) {
      drops.forEach(function (d) {
        if (d === except) return;
        var b = d.querySelector('.nav-drop-btn');
        var m = d.querySelector('.nav-drop-menu');
        if (b) b.setAttribute('aria-expanded', 'false');
        if (m) m.hidden = true;
      });
    }

    drops.forEach(function (d) {
      var btn = d.querySelector('.nav-drop-btn');
      var menu = d.querySelector('.nav-drop-menu');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.hidden;
        closeAll(d);
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      });
      menu.addEventListener('click', function (e) {
        if (e.target.tagName === 'A') closeAll(null);
      });
    });

    document.addEventListener('click', function () { closeAll(null); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(null); });
  }

  function renderFooter() {
    var footer = document.getElementById('site-footer');
    if (!footer) return;
    var src = footer.getAttribute('data-source');
    var extra = footer.getAttribute('data-extra');
    var parts = ['© 2026'];
    if (src) parts.push('데이터 출처: ' + src);
    if (extra) parts.push(extra);
    parts.push('<a href="mailto:aithrume@gmail.com">이메일</a>');
    parts.push('<a href="https://github.com/aithrume" target="_blank" rel="noopener">GitHub</a>');
    footer.innerHTML = '<div class="container"><p>' + parts.join(' · ') + '</p></div>';
  }

  renderHeader();
  renderFooter();
  window.addEventListener('hashchange', renderHeader);
})();
