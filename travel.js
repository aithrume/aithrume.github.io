/* =========================================================
   travel.js - 여행 지도 (Leaflet)
   ---------------------------------------------------------
   여행을 추가하려면 data/travel.json 에 한 줄만 추가하면 끝!
     { "name": "오사카", "country": "JPN", "lat": 34.69, "lng": 135.50, "visits": ["2019-05", "2024-01"] }
   - country : 나라 코드 (ADM0_A3, 예: KOR 한국, JPN 일본, USA 미국, FRA 프랑스)
   - lat/lng : 도시 위치 (구글 지도에서 장소를 마우스 오른쪽 클릭하면 나오는 숫자)
               없으면 핀 없이 나라만 색칠됩니다.
   - visits  : 방문한 년월 목록 "YYYY-MM"
   - 한국 도시는 핀이 들어 있는 시군구가 자동으로 색칠됩니다.
   ========================================================= */

(function () {
  var mapEl = document.getElementById("travel-map");
  if (!mapEl) return;

  var KOREA_ZOOM = 6;   // 이 확대 단계부터 한국을 시군구로 보여줌
  var STYLE = {
    visited: { fillColor: "#34d399", fillOpacity: 0.85, color: "#ffffff", weight: 0.6, opacity: 1 },
    none:    { fillColor: "#e5e7eb", fillOpacity: 1,    color: "#ffffff", weight: 0.6, opacity: 1 },
    hidden:  { fillOpacity: 0, opacity: 0 }
  };

  // ---------- 1. 지도 만들기 (배경 타일 없이 경계만 그림) ----------
  var map = L.map("travel-map", {
    scrollWheelZoom: false,                       // 페이지 스크롤 중 실수로 확대되는 것 방지
    minZoom: 1, maxZoom: 12, zoomSnap: 0.5,
    maxBounds: [[-85, -200], [85, 200]], maxBoundsViscosity: 1, worldCopyJump: false
  });
  map.on("click", function () { map.scrollWheelZoom.enable(); });
  map.on("mouseout", function () { map.scrollWheelZoom.disable(); });
  map.attributionControl.addAttribution("국경: Natural Earth");
  map.createPane("pins").style.zIndex = 650;      // 핀은 경계보다 위에
  map.setView([25, 15], 2);

  // ---------- 2. 보조 함수 ----------
  function ym(v) { return v.slice(0, 4) + "." + v.slice(5, 7); }        // "2019-05" → "2019.05"
  function ymList(visits) { return visits.map(ym).join(", "); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function inRing(x, y, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
    return c;
  }
  function contains(f, lng, lat) {                // 점이 경계 안에 있는지 (구멍 포함)
    return f.geometry.coordinates.some(function (poly) {
      var inside = false;
      poly.forEach(function (r) { if (inRing(lng, lat, r)) inside = !inside; });
      return inside;
    });
  }
  function sggName(n) { return n.replace(/^(.+시)(.+구)$/, "$1 $2"); }   // '수원시장안구' → '수원시 장안구'
  // 가장 큰 조각(본토)의 범위 - 프랑스령 기아나 같은 해외 영토 때문에 지나치게 멀리 보이지 않게
  function mainBounds(f) {
    var big = null, size = -1;
    f.geometry.coordinates.forEach(function (poly) {
      var b = L.latLngBounds(poly[0].map(function (p) { return [p[1], p[0]]; }));
      var s = (b.getEast() - b.getWest()) * (b.getNorth() - b.getSouth());
      if (s > size) { size = s; big = b; }
    });
    return big;
  }
  function placeLine(p) { return "<strong>" + esc(p.name) + "</strong> " + ymList(p.visits); }

  function fetchJson(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " 를 불러오지 못했습니다.");
      return r.json();
    });
  }

  // ---------- 3. 데이터 불러와서 그리기 ----------
  Promise.all([fetchJson("data/travel.json"), fetchJson("data/geo_world.json"),
               fetchJson("data/geo_sido.json"), fetchJson("data/geo_sigungu.json")])
    .then(function (r) { draw(r[0], r[1], r[2], r[3]); })
    .catch(function (err) {
      console.error(err);
      document.getElementById("travel-summary").textContent =
        "지도를 불러오지 못했습니다. (" + err.message + ") 로컬에서는 http 서버로 열어야 합니다.";
    });

  function draw(places, world, geoSido, geoSgg) {
    // 나라별로 묶기
    var countries = {};                           // 코드 → { visits: [...], places: [...] }
    places.forEach(function (p) {
      p.visits = (p.visits || []).slice().sort();
      var c = countries[p.country] = countries[p.country] || { visits: [], places: [] };
      p.visits.forEach(function (v) { if (c.visits.indexOf(v) < 0) c.visits.push(v); });
      if (p.name) c.places.push(p);
    });
    Object.keys(countries).forEach(function (k) { countries[k].visits.sort(); });
    var nameOf = {};
    world.features.forEach(function (f) { nameOf[f.properties.code] = f.properties.name; });

    // 세계: 나라
    var korLayer = null;
    var worldLayer = L.geoJSON(world, {
      style: function (f) { return countries[f.properties.code] ? STYLE.visited : STYLE.none; },
      onEachFeature: function (f, layer) {
        var c = countries[f.properties.code];
        var tip = "<strong>" + esc(f.properties.name) + "</strong>";
        if (c) {
          tip += c.places.length ? "<br>" + c.places.map(placeLine).join("<br>") : "<br>방문 " + ymList(c.visits);
        }
        layer.bindTooltip(tip, { sticky: true });
        if (f.properties.code === "KOR") {
          korLayer = layer;
          layer.on("click", showKorea);
        }
        hoverEffect(layer);
      }
    }).addTo(map);

    // 한국: 시군구 (확대했을 때만 보임). 핀이 들어 있는 시군구를 방문으로 표시
    var sidoName = {};
    geoSido.features.forEach(function (f) { sidoName[f.properties.code] = f.properties.name; });
    var korPlaces = places.filter(function (p) { return p.country === "KOR" && p.lat != null; });
    var visitedSgg = 0;
    var sggLayer = L.geoJSON(geoSgg, {
      style: function (f) {
        f.places = korPlaces.filter(function (p) { return contains(f, p.lng, p.lat); });
        if (f.places.length) visitedSgg++;
        return f.places.length ? STYLE.visited : STYLE.none;
      },
      onEachFeature: function (f, layer) {
        var full = (sidoName[f.properties.code.slice(0, 2)] || "") + " " + sggName(f.properties.name);
        var tip = "<strong>" + esc(full) + "</strong>";
        if (f.places.length) tip += "<br>" + f.places.map(placeLine).join("<br>");
        layer.bindTooltip(tip, { sticky: true });
        hoverEffect(layer);
      }
    });
    var koreaBounds = L.geoJSON(geoSido).getBounds();

    // 도시 핀
    places.forEach(function (p) {
      if (p.lat == null || p.lng == null) return;
      var tip = "<strong>" + esc(p.name || "") + "</strong> (" + esc(nameOf[p.country] || p.country) + ")<br>" +
                ymList(p.visits) + (p.memo ? "<br>" + esc(p.memo) : "");
      L.circleMarker([p.lat, p.lng], {
        pane: "pins", radius: 6, color: "#ffffff", weight: 2, fillColor: "#e11d48", fillOpacity: 1
      }).bindTooltip(tip, { direction: "top", offset: [0, -6] }).addTo(map);
    });

    // 확대 정도에 따라 한국을 나라 ↔ 시군구로 바꿔 보여줌
    function syncKorea() {
      var korea = map.getZoom() >= KOREA_ZOOM && map.getBounds().intersects(koreaBounds);
      if (korea && !map.hasLayer(sggLayer)) {
        sggLayer.addTo(map);
        if (korLayer) { korLayer.setStyle(STYLE.hidden); korLayer.closeTooltip(); }
      } else if (!korea && map.hasLayer(sggLayer)) {
        map.removeLayer(sggLayer);
        if (korLayer) korLayer.setStyle(countries.KOR ? STYLE.visited : STYLE.none);
      }
      document.getElementById("view-korea").classList.toggle("on", korea);
      document.getElementById("view-world").classList.toggle("on", !korea);
    }
    map.on("zoomend moveend", syncKorea);

    function showKorea() { map.flyToBounds(koreaBounds, { padding: [20, 20], duration: 0.8 }); }
    function showWorld() { map.flyTo([25, 15], 2, { duration: 0.8 }); }
    document.getElementById("view-korea").addEventListener("click", showKorea);
    document.getElementById("view-world").addEventListener("click", showWorld);

    // 마우스를 올리면 경계선 강조
    function hoverEffect(layer) {
      layer.on("mouseover", function () { if (layer.options.fillOpacity !== 0) layer.setStyle({ color: "#374151", weight: 1.6 }); });
      layer.on("mouseout", function () { if (layer.options.fillOpacity !== 0) layer.setStyle({ color: "#ffffff", weight: 0.6 }); });
    }

    // 요약
    var codes = Object.keys(countries);
    var cityCount = places.filter(function (p) { return p.name; }).length;
    document.getElementById("travel-summary").innerHTML =
      "나라 <strong>" + codes.length + "</strong>곳 · 도시 <strong>" + cityCount + "</strong>곳 · " +
      "국내 시군구 <strong>" + visitedSgg + "</strong>곳";

    // 나라별 목록 (최근 방문 순)
    var listEl = document.getElementById("travel-list");
    codes.sort(function (a, b) {
      var va = countries[a].visits, vb = countries[b].visits;
      return (vb[vb.length - 1] || "").localeCompare(va[va.length - 1] || "");
    });
    codes.forEach(function (code) {
      var c = countries[code], li = document.createElement("li");
      li.className = "travel-item";
      var title = document.createElement("strong");
      title.textContent = nameOf[code] || code + " (나라 코드 확인 필요)";
      var meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = c.places.length
        ? c.places.map(function (p) { return p.name + " " + ymList(p.visits); }).join(" · ")
        : "방문 " + ymList(c.visits);
      li.appendChild(title);
      li.appendChild(meta);
      li.addEventListener("click", function () {
        if (code === "KOR") { showKorea(); }
        else {
          var target = null;
          worldLayer.eachLayer(function (l) { if (l.feature.properties.code === code) target = l; });
          if (target) map.flyToBounds(mainBounds(target.feature), { padding: [30, 30], maxZoom: 5, duration: 0.8 });
        }
        mapEl.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      listEl.appendChild(li);
    });
  }
})();
