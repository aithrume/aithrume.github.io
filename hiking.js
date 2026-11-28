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
    // 고도 프로필용 (거리 km, 고도 m, 위도, 경도) 샘플링 (최대 ~160점, 최고점 보존)
    var rawProfile = [], cumDist = 0;
    for (var p = 0; p < pts.length; p++) {
      if (p > 0) cumDist += haversine(pts[p - 1], pts[p]);
      if (!isNaN(eles[p])) {
        rawProfile.push({ distKm: cumDist / 1000, ele: eles[p], lat: pts[p][0], lon: pts[p][1] });
      }
    }
    var profile = rawProfile;
    if (rawProfile.length > 160) {
      var step = Math.ceil(rawProfile.length / 160), peakI = 0;
      for (var q = 1; q < rawProfile.length; q++) if (rawProfile[q].ele > rawProfile[peakI].ele) peakI = q;
      var keep = {};
      for (var q2 = 0; q2 < rawProfile.length; q2 += step) keep[q2] = true;
      keep[0] = true; keep[rawProfile.length - 1] = true; keep[peakI] = true;
      profile = Object.keys(keep).map(Number).sort(function (a, b) { return a - b; }).map(function (i) { return rawProfile[i]; });
    }
    return { points: pts, distance: dist, ascent: ascent, maxEle: maxEle, profile: profile };
  }

  function fmt(n) { return Math.round(n).toLocaleString("ko-KR"); }

  // ---------- 2-b. 고도 프로필 SVG + 지도 커서 연동 ----------
  var SVGNS = "http://www.w3.org/2000/svg";
  var eleCard = document.getElementById("ele-card");
  var eleSvg = document.getElementById("ele-svg");
  var eleTitle = document.getElementById("ele-title");
  var eleStats = document.getElementById("ele-stats");
  var eleHover = document.getElementById("ele-hover");
  var cursorMarker = null;

  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function clearElevation() {
    if (eleCard) eleCard.hidden = true;
    if (cursorMarker) { map.removeLayer(cursorMarker); cursorMarker = null; }
  }

  function renderElevation(it) {
    if (!eleCard || !eleSvg || !it || !it.profile || it.profile.length < 2) {
      clearElevation();
      return;
    }
    var pts = it.profile;
    eleCard.hidden = false;
    eleTitle.textContent = it.title + " 고도 프로필 ";
    eleStats.textContent = "· " + (it.distance / 1000).toFixed(1) + " km · 누적상승 " + fmt(it.ascent) + " m" +
      (it.maxEle !== null ? " · 최고 " + fmt(it.maxEle) + " m" : "");

    eleSvg.innerHTML = "";
    var W = 880, H = 210, ML = 54, MR = 24, MT = 22, MB = 30;
    var pw = W - ML - MR, ph = H - MT - MB;
    var maxDist = pts[pts.length - 1].distKm || 0.1;
    var eles = pts.map(function (p) { return p.ele; });
    var minE = Math.min.apply(null, eles), maxE = Math.max.apply(null, eles);
    var lo = Math.floor(minE / 100) * 100;
    var hi = Math.ceil((maxE + Math.max(40, (maxE - minE) * 0.12)) / 100) * 100;
    if (hi <= lo) hi = lo + 100;

    var defs = svgEl("defs", {}, eleSvg);
    var grad = svgEl("linearGradient", { id: "hikeEleGrad", x1: "0", y1: "0", x2: "0", y2: "1" }, defs);
    svgEl("stop", { offset: "0%", "stop-color": it.color, "stop-opacity": "0.32" }, grad);
    svgEl("stop", { offset: "100%", "stop-color": it.color, "stop-opacity": "0.04" }, grad);

    function X(d) { return ML + (d / maxDist) * pw; }
    function Y(e) { return MT + (1 - (e - lo) / (hi - lo)) * ph; }

    for (var k = 0; k <= 4; k++) {
      var v = lo + (hi - lo) * (k / 4);
      var y = Y(v);
      svgEl("line", { x1: ML, x2: W - MR, y1: y, y2: y, stroke: k === 0 ? "#cbd5e1" : "#eef0f3" }, eleSvg);
      svgEl("text", { x: ML - 8, y: y + 4, "text-anchor": "end" }, eleSvg).textContent = Math.round(v) + "m";
    }

    var stepKm = maxDist > 16 ? 3 : maxDist > 8 ? 2 : 1;
    for (var km = 0; km <= maxDist - stepKm * 0.4; km += stepKm) {
      svgEl("text", { x: X(km), y: H - 8, "text-anchor": "middle" }, eleSvg).textContent = km + " km";
    }
    svgEl("text", { x: X(maxDist), y: H - 8, "text-anchor": "end" }, eleSvg).textContent = maxDist.toFixed(1) + " km";

    var lineD = pts.map(function (p, i) { return (i ? "L" : "M") + X(p.distKm).toFixed(1) + "," + Y(p.ele).toFixed(1); }).join("");
    var areaD = lineD + "L" + X(maxDist).toFixed(1) + "," + (H - MB) + "L" + ML + "," + (H - MB) + "Z";
    svgEl("path", { d: areaD, fill: "url(#hikeEleGrad)" }, eleSvg);
    svgEl("path", { d: lineD, fill: "none", stroke: it.color, "stroke-width": "2.4", "stroke-linejoin": "round" }, eleSvg);

    var peakIdx = 0;
    pts.forEach(function (p, i) { if (p.ele > pts[peakIdx].ele) peakIdx = i; });
    var pk = pts[peakIdx];
    svgEl("circle", { cx: X(pk.distKm), cy: Y(pk.ele), r: "4", fill: "#ffffff", stroke: it.color, "stroke-width": "2.2" }, eleSvg);
    svgEl("text", { x: X(pk.distKm), y: Math.max(14, Y(pk.ele) - 8), "text-anchor": "middle", style: "font-weight:700;fill:" + it.color }, eleSvg)
      .textContent = "최고 " + Math.round(pk.ele) + "m";

    var cross = svgEl("line", { y1: MT, y2: H - MB, stroke: "#475569", "stroke-dasharray": "3 3" }, eleSvg);
    var dot = svgEl("circle", { r: "5", fill: "#dc2626", stroke: "#ffffff", "stroke-width": "2.2" }, eleSvg);
    var hit = svgEl("rect", { x: ML, y: MT, width: pw, height: ph, fill: "transparent", style: "cursor:crosshair" }, eleSvg);

    if (!cursorMarker) {
      cursorMarker = L.circleMarker([pk.lat, pk.lon], {
        radius: 7, color: "#ffffff", weight: 2.5, fillColor: "#dc2626", fillOpacity: 1
      }).addTo(map);
    }

    function showAt(i, moveMapPin) {
      var p = pts[i];
      cross.setAttribute("x1", X(p.distKm)); cross.setAttribute("x2", X(p.distKm));
      dot.setAttribute("cx", X(p.distKm)); dot.setAttribute("cy", Y(p.ele));
      if (moveMapPin && cursorMarker) {
        cursorMarker.setLatLng([p.lat, p.lon]).bringToFront();
      }
      var prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      var dd = (next.distKm - prev.distKm) * 1000;
      var slope = dd > 10 ? ((next.ele - prev.ele) / dd * 100) : 0;
      var slopeStr = (slope > 0.5 ? "+" : "") + slope.toFixed(0) + "%";
      eleHover.textContent = "거리 " + p.distKm.toFixed(2) + " km · 고도 " + Math.round(p.ele) + " m · 경사 " + slopeStr;
    }

    hit.addEventListener("pointermove", function (e) {
      var r = eleSvg.getBoundingClientRect();
      var px = (e.clientX - r.left) * (W / r.width);
      var targetD = Math.max(0, Math.min(maxDist, (px - ML) / pw * maxDist));
      var best = 0, bestDiff = Infinity;
      for (var i = 0; i < pts.length; i++) {
        var diff = Math.abs(pts[i].distKm - targetD);
        if (diff < bestDiff) { bestDiff = diff; best = i; }
      }
      showAt(best, true);
    });
    hit.addEventListener("pointerleave", function () { showAt(peakIdx, true); });
    showAt(peakIdx, true);
  }

  // ---------- 3. 불러와서 그리기 ----------
  var items = [];   // { line, li, bounds }
  var activeIdx = -1;

  function select(idx, fit) {
    items.forEach(function (it, i) {
      var on = i === idx;
      it.li.classList.toggle("active", on);
      var dim = idx >= 0 && !on;                      // 하나를 고르면 나머지는 옅게
      it.line.setStyle({ weight: on ? 6 : 5, opacity: dim ? 0.5 : 1 });
      it.casing.setStyle({ weight: on ? 10 : 9, opacity: dim ? 0.4 : 0.9 });
      if (on) { it.casing.bringToFront(); it.line.bringToFront(); }
    });
    activeIdx = idx;
    if (idx >= 0) {
      if (fit) map.fitBounds(items[idx].bounds, { padding: [30, 30] });
      renderElevation(items[idx]);
    } else {
      clearElevation();
    }
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
      if (it.visible) { it.group.addTo(map); } else { map.removeLayer(it.group); }
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

        // 지도에 선 그리기: 흰 테두리(아래) + 색 선(위) - 어떤 바탕 지도에서도 잘 보이게
        var casing = L.polyline(d.points, { color: "#ffffff", weight: 9, opacity: 0.9, interactive: false });
        var line = L.polyline(d.points, { color: color, weight: 5, opacity: 1 });
        var group = L.layerGroup([casing, line]).addTo(map);
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
        var parts = [t.region || "기타", (d.distance / 1000).toFixed(1) + " km", "누적상승 " + fmt(d.ascent) + " m"];
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
        items.push({
          title: t.title, color: color, distance: d.distance, ascent: d.ascent, maxEle: d.maxEle, profile: d.profile,
          line: line, casing: casing, group: group, li: li, bounds: line.getBounds(), region: t.region || "기타", visible: true
        });
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
