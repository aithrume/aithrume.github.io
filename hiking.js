/* =========================================================
   hiking.js - GPX 파일을 지도(Leaflet)에 그려주는 스크립트
   ---------------------------------------------------------
   산행을 추가하려면:
   1) data/gpx/ 폴더에 .gpx 파일을 넣고
   2) tracks.json 에 한 줄(제목, 날짜, 파일 경로)만 추가하면 끝!
   ========================================================= */

(function () {
  // 트랙마다 다른 색으로 그리기 위한 색상표
  var COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

  var mapEl = document.getElementById("map");
  var listEl = document.getElementById("track-list");
  if (!mapEl || !listEl) return;

  // ---------- 1. 지도 만들기 ----------
  var map = L.map("map", { scrollWheelZoom: false }); // 페이지 스크롤 중 실수로 확대되는 것 방지
  map.on("click", function () { map.scrollWheelZoom.enable(); });
  map.on("mouseout", function () { map.scrollWheelZoom.disable(); });

  var osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors"
  });
  var topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: "© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors"
  });
  topo.addTo(map); // 등산이니까 지형도를 기본으로
  L.control.layers({ "지형도": topo, "일반 지도": osm }).addTo(map);
  map.setView([37.0, 127.8], 7); // 데이터 로딩 전 임시 위치(한국)

  // ---------- 2. 보조 함수 ----------
  // 두 좌표 사이 거리(m) - GPX에 거리 정보가 없을 때를 대비한 계산
  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function numTag(doc, name) {
    var el = doc.getElementsByTagName(name)[0];
    var v = el ? parseFloat(el.textContent) : NaN;
    return isNaN(v) ? null : v;
  }

  // GPX 텍스트 → { 좌표들, 거리, 상승, 최고고도 }
  function parseGpx(text) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("GPX 파싱 실패");

    var pts = [], eles = [];
    var nodes = doc.getElementsByTagName("trkpt");
    for (var i = 0; i < nodes.length; i++) {
      var lat = parseFloat(nodes[i].getAttribute("lat"));
      var lon = parseFloat(nodes[i].getAttribute("lon"));
      if (isNaN(lat) || isNaN(lon)) continue;
      pts.push([lat, lon]);
      var e = nodes[i].getElementsByTagName("ele")[0];
      eles.push(e ? parseFloat(e.textContent) : NaN);
    }

    // 네이버 지도 GPX에 들어있는 통계값을 우선 사용, 없으면 직접 계산
    var dist = numTag(doc, "nmap:distance");
    if (dist === null) {
      dist = 0;
      for (var j = 1; j < pts.length; j++) dist += haversine(pts[j - 1], pts[j]);
    }
    var ascent = numTag(doc, "nmap:totalAscent");
    if (ascent === null) {
      ascent = 0;
      for (var k = 1; k < eles.length; k++) {
        var d = eles[k] - eles[k - 1];
        if (d > 0) ascent += d;
      }
    }
    var maxEle = numTag(doc, "nmap:altMax");
    if (maxEle === null) {
      var valid = eles.filter(function (x) { return !isNaN(x); });
      maxEle = valid.length ? Math.max.apply(null, valid) : null;
    }
    return { points: pts, distance: dist, ascent: ascent, maxEle: maxEle };
  }

  function fmt(n) { return Math.round(n).toLocaleString("ko-KR"); }

  // ---------- 3. 불러와서 그리기 ----------
  var items = [];   // { line, li, bounds }
  var activeIdx = -1;

  function select(idx, fit) {
    items.forEach(function (it, i) {
      var on = i === idx;
      it.li.classList.toggle("active", on);
      it.line.setStyle({ weight: on ? 6 : 4, opacity: on ? 1 : 0.55 });
      if (on) it.line.bringToFront();
    });
    activeIdx = idx;
    if (fit && idx >= 0) map.fitBounds(items[idx].bounds, { padding: [30, 30] });
  }

  // 지금 보이는(필터에 걸린) 산행만 한 화면에 맞춰 보여주기
  function showAll() {
    var all = L.latLngBounds([]);
    items.forEach(function (it) { if (it.visible) all.extend(it.bounds); });
    if (all.isValid()) map.fitBounds(all, { padding: [30, 30] });
    select(-1, false);
  }

  // 지역 필터 적용: 목록과 지도의 선을 함께 보이거나 숨김
  var REGION_ORDER = ["서울", "경기", "인천", "강원", "충청", "전라", "경상", "제주"];
  var currentRegion = "all";

  function applyFilter(region) {
    currentRegion = region;
    items.forEach(function (it) {
      it.visible = region === "all" || it.region === region;
      it.li.hidden = !it.visible;
      if (it.visible) { it.line.addTo(map); } else { map.removeLayer(it.line); }
    });
    var chips = document.querySelectorAll("#region-filter .chip");
    Array.prototype.forEach.call(chips, function (c) {
      c.classList.toggle("on", c.dataset.region === region);
    });
    showAll();
  }

  function buildFilter() {
    var box = document.getElementById("region-filter");
    if (!box) return;
    var counts = {};
    items.forEach(function (it) { counts[it.region] = (counts[it.region] || 0) + 1; });
    var regions = Object.keys(counts).sort(function (a, b) {
      var ia = REGION_ORDER.indexOf(a), ib = REGION_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    box.innerHTML = "";
    [["all", "전체", items.length]].concat(regions.map(function (r) { return [r, r, counts[r]]; }))
      .forEach(function (x) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "chip" + (x[0] === "all" ? " on" : "");
        b.dataset.region = x[0];
        b.textContent = x[1] + " " + x[2];
        b.addEventListener("click", function () { applyFilter(x[0]); });
        box.appendChild(b);
      });
  }

  function showError(msg) {
    var p = document.createElement("p");
    p.className = "track-error";
    p.textContent = msg;
    listEl.appendChild(p);
  }

  fetch("tracks.json")
    .then(function (r) {
      if (!r.ok) throw new Error("tracks.json 을 불러오지 못했습니다.");
      return r.json();
    })
    .then(function (tracks) {
      // 각 GPX를 동시에 불러오기
      return Promise.all(tracks.map(function (t) {
        return fetch(t.file)
          .then(function (r) {
            if (!r.ok) throw new Error(t.file + " 를 찾을 수 없습니다.");
            return r.text();
          })
          .then(function (text) { return { info: t, data: parseGpx(text) }; })
          .catch(function (err) { console.error(err); return { info: t, error: err }; });
      }));
    })
    .then(function (results) {
      results.forEach(function (res) {
        if (res.error) { showError(res.info.title + ": 불러오기 실패"); return; }
        var t = res.info, d = res.data;
        var color = COLORS[items.length % COLORS.length];

        // 지도에 선 그리기
        var line = L.polyline(d.points, { color: color, weight: 4, opacity: 0.8 }).addTo(map);
        line.bindTooltip(t.title, { sticky: true });
        var idx = items.length;
        line.on("click", function () { select(idx, false); res.li.scrollIntoView({ block: "nearest", behavior: "smooth" }); });

        // 목록 항목 만들기
        var li = document.createElement("li");
        li.className = "track";
        li.style.setProperty("--track-color", color);

        var info = document.createElement("div");
        var strong = document.createElement("strong");
        strong.textContent = t.title;
        var meta = document.createElement("span");
        meta.className = "meta";
        var parts = [t.region || "기타", t.date, (d.distance / 1000).toFixed(1) + " km", "누적상승 " + fmt(d.ascent) + " m"];
        if (d.maxEle !== null) parts.push("최고 " + fmt(d.maxEle) + " m");
        meta.textContent = parts.join(" · ");
        info.appendChild(strong);
        info.appendChild(meta);

        var a = document.createElement("a");
        a.className = "link";
        a.href = t.file;
        a.setAttribute("download", "");
        a.textContent = "GPX 다운로드";
        a.addEventListener("click", function (e) { e.stopPropagation(); }); // 다운로드 클릭 시 선택 동작 방지

        li.appendChild(info);
        li.appendChild(a);
        li.addEventListener("click", function () {
          select(idx, true);
          mapEl.scrollIntoView({ block: "center", behavior: "smooth" });
        });
        listEl.appendChild(li);

        res.li = li;
        items.push({ line: line, li: li, bounds: line.getBounds(), region: t.region || "기타", visible: true });
      });

      if (items.length) { buildFilter(); showAll(); }
      else showError("표시할 트랙이 없습니다.");
    })
    .catch(function (err) {
      console.error(err);
      showError("트랙을 불러오지 못했습니다. (" + err.message + ") 로컬에서는 http 서버로 열어야 합니다.");
    });

  // 지도 아래 "전체 보기" 버튼
  var btn = document.getElementById("show-all");
  if (btn) btn.addEventListener("click", showAll);
})();
