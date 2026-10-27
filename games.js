/* =========================================================
   games.js - 숫자야구 · 스도쿠
   ========================================================= */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // ---------- 탭 (주소 끝 #sudoku 로 바로 열 수도 있음) ----------
  var tabs = document.querySelectorAll('[data-tab]');
  function showTab(name) {
    tabs.forEach(function (b) { b.classList.toggle('on', b.dataset.tab === name); });
    $('tab-baseball').hidden = name !== 'baseball';
    $('tab-sudoku').hidden = name !== 'sudoku';
  }
  tabs.forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.dataset.tab); history.replaceState(null, '', '#' + b.dataset.tab); });
  });
  if (location.hash === '#sudoku') showTab('sudoku');

  /* =========================================================
     숫자야구
     ========================================================= */
  var BB_TRIES = 10;
  var bb = { answer: '', tries: 0, over: false };

  function bbNew() {
    bb.answer = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]).slice(0, 3).join('');   // 1~9 중 서로 다른 3개
    bb.tries = 0; bb.over = false;
    $('bb-history').innerHTML = '';
    $('bb-left').textContent = BB_TRIES;
    $('bb-msg').textContent = '새 게임을 시작했습니다. 숫자 3개를 입력하세요.';
    $('bb-msg').className = 'game-msg';
    $('bb-input').disabled = false;
    $('bb-input').value = '';
    $('bb-input').focus();
  }
  function bbJudge(guess) {
    var s = 0, b = 0;
    for (var i = 0; i < 3; i++) {
      if (guess[i] === bb.answer[i]) s++;
      else if (bb.answer.indexOf(guess[i]) >= 0) b++;
    }
    return { s: s, b: b };
  }
  $('bb-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (bb.over) return;
    var g = $('bb-input').value.trim(), msg = $('bb-msg');
    if (!/^[1-9]{3}$/.test(g)) { msg.textContent = '1~9 숫자 3개를 입력하세요. (0 제외)'; msg.className = 'game-msg warn'; return; }
    if (new Set(g).size !== 3) { msg.textContent = '서로 다른 숫자 3개를 입력하세요.'; msg.className = 'game-msg warn'; return; }

    bb.tries++;
    var r = bbJudge(g);
    var text = r.s === 0 && r.b === 0 ? '아웃' : [r.s ? r.s + ' 스트라이크' : '', r.b ? r.b + ' 볼' : ''].filter(Boolean).join(' ');
    var li = document.createElement('li');
    li.innerHTML = '<span class="bb-n">' + bb.tries + '회</span><span class="bb-guess">' + g + '</span>' +
      '<span class="bb-res">' + '<i class="s">' + 'S'.repeat(r.s) + '</i><i class="b">' + 'B'.repeat(r.b) + '</i></span>' +
      '<span class="bb-text">' + text + '</span>';
    $('bb-history').prepend(li);
    $('bb-left').textContent = BB_TRIES - bb.tries;
    $('bb-input').value = '';

    if (r.s === 3) {
      bb.over = true; $('bb-input').disabled = true;
      msg.textContent = '🎉 성공! ' + bb.tries + '번 만에 맞혔습니다. 정답 ' + bb.answer;
      msg.className = 'game-msg ok';
    } else if (bb.tries >= BB_TRIES) {
      bb.over = true; $('bb-input').disabled = true;
      msg.textContent = '😢 실패! 10번 안에 맞히지 못했습니다. 정답은 ' + bb.answer + ' 입니다.';
      msg.className = 'game-msg fail';
    } else {
      msg.textContent = g + ' → ' + text;
      msg.className = 'game-msg';
      $('bb-input').focus();
    }
  });
  $('bb-input').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/[^1-9]/g, '').slice(0, 3); });
  $('bb-new').addEventListener('click', bbNew);
  bbNew();

  /* =========================================================
     스도쿠
     ========================================================= */
  var SD_LIMIT = 180;                                   // 제한 시간(초) = 3분
  var BLANKS = { easy: 30, normal: 40, hard: 48 };      // 난이도별 빈칸 수
  var sd = { level: 'easy', puzzle: null, solution: null, cells: [], timer: 0, start: 0, running: false, over: false };

  // 81칸 배열에서 i 칸에 n 을 넣어도 되는지
  function canPlace(g, i, n) {
    var r = Math.floor(i / 9), c = i % 9, br = r - r % 3, bc = c - c % 3;
    for (var k = 0; k < 9; k++) {
      if (g[r * 9 + k] === n || g[k * 9 + c] === n) return false;
      if (g[(br + Math.floor(k / 3)) * 9 + bc + k % 3] === n) return false;
    }
    return true;
  }
  // 빈칸(0)을 채워 완성 (무작위 순서) → 완성판 만들기
  function fill(g) {
    var i = g.indexOf(0);
    if (i < 0) return true;
    var nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (var k = 0; k < 9; k++) {
      if (canPlace(g, i, nums[k])) { g[i] = nums[k]; if (fill(g)) return true; g[i] = 0; }
    }
    return false;
  }
  // 답의 개수를 최대 limit 개까지 셈 (답이 하나뿐인지 확인용)
  function countSolutions(g, limit) {
    var i = g.indexOf(0);
    if (i < 0) return 1;
    var cnt = 0;
    for (var n = 1; n <= 9 && cnt < limit; n++) {
      if (canPlace(g, i, n)) { g[i] = n; cnt += countSolutions(g, limit - cnt); g[i] = 0; }
    }
    return cnt;
  }
  function makePuzzle(blanks) {
    var sol = new Array(81).fill(0);
    fill(sol);
    var p = sol.slice(), removed = 0;
    shuffle(Array.from({ length: 81 }, function (_, i) { return i; })).forEach(function (i) {
      if (removed >= blanks) return;
      var keep = p[i];
      p[i] = 0;
      if (countSolutions(p.slice(), 2) !== 1) p[i] = keep;   // 답이 여러 개가 되면 되돌림
      else removed++;
    });
    return { puzzle: p, solution: sol };
  }

  function fmtTime(sec) { return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function setTimer(elapsed) {
    elapsed = Math.min(SD_LIMIT, elapsed);
    $('sd-elapsed').textContent = fmtTime(elapsed);
    $('sd-left').textContent = fmtTime(SD_LIMIT - elapsed);
    var bar = $('sd-bar');
    bar.style.width = (elapsed / SD_LIMIT * 100) + '%';
    bar.className = SD_LIMIT - elapsed <= 30 ? 'danger' : SD_LIMIT - elapsed <= 60 ? 'warn' : '';
  }

  function sdNew() {
    stopTimer();
    var made = makePuzzle(BLANKS[sd.level]);
    sd.puzzle = made.puzzle; sd.solution = made.solution;
    sd.running = false; sd.over = false;
    setTimer(0);
    $('sd-start').disabled = false;
    $('sd-msg').textContent = "'시작'을 누르면 문제가 열리고 3분이 흐르기 시작합니다.";
    $('sd-msg').className = 'game-msg';
    drawBoard(true);
  }

  function drawBoard(hiddenNumbers) {
    var board = $('sd-board');
    board.innerHTML = '';
    board.classList.toggle('waiting', !!hiddenNumbers);
    sd.cells = [];
    for (var i = 0; i < 81; i++) {
      var given = sd.puzzle[i] !== 0, cell = document.createElement('input');
      cell.type = 'text'; cell.inputMode = 'numeric'; cell.maxLength = 1;
      cell.className = 'sd-cell' + (given ? ' given' : '');
      cell.dataset.i = i;
      cell.setAttribute('aria-label', (Math.floor(i / 9) + 1) + '행 ' + (i % 9 + 1) + '열');
      if (given) { cell.value = hiddenNumbers ? '' : sd.puzzle[i]; cell.readOnly = true; }
      cell.disabled = !!hiddenNumbers;
      cell.addEventListener('input', onCellInput);
      cell.addEventListener('keydown', onCellKey);
      board.appendChild(cell);
      sd.cells.push(cell);
    }
  }

  function startGame() {
    if (sd.running || sd.over) return;
    drawBoard(false);
    sd.running = true;
    sd.start = Date.now();
    $('sd-start').disabled = true;
    $('sd-msg').textContent = '빈칸을 채워 주세요!';
    sd.timer = setInterval(tick, 250);
    var first = sd.cells.filter(function (c) { return !c.readOnly; })[0];
    if (first) first.focus();
  }
  function tick() {
    var elapsed = Math.floor((Date.now() - sd.start) / 1000);
    setTimer(elapsed);
    if (elapsed >= SD_LIMIT) finish(false);
  }
  function stopTimer() { clearInterval(sd.timer); sd.timer = 0; }

  function finish(win) {
    stopTimer();
    sd.running = false; sd.over = true;
    sd.cells.forEach(function (c, i) {
      c.readOnly = true;
      if (!win && !c.classList.contains('given')) {             // 실패하면 정답을 보여줌
        if (+c.value !== sd.solution[i]) { c.value = sd.solution[i]; c.classList.add('reveal'); }
      }
    });
    var used = Math.min(SD_LIMIT, Math.floor((Date.now() - sd.start) / 1000));
    $('sd-msg').textContent = win ? '🎉 성공! ' + fmtTime(used) + ' 만에 풀었습니다.' : '⏰ 실패! 3분이 지났습니다. 정답을 표시했습니다.';
    $('sd-msg').className = 'game-msg ' + (win ? 'ok' : 'fail');
  }

  // 같은 줄·칸에 겹치는 숫자를 빨갛게, 다 채워졌고 겹침이 없으면 성공
  function check() {
    var g = sd.cells.map(function (c) { return +c.value || 0; });
    var bad = 0;
    sd.cells.forEach(function (c, i) {
      var n = g[i], clash = false;
      if (n) { g[i] = 0; clash = !canPlace(g, i, n); g[i] = n; }
      c.classList.toggle('clash', clash);
      if (clash) bad++;
    });
    if (sd.running && bad === 0 && g.indexOf(0) < 0) finish(true);
  }
  function onCellInput(e) {
    var c = e.target;
    c.value = c.value.replace(/[^1-9]/g, '').slice(-1);
    check();
  }
  function onCellKey(e) {                                  // 방향키로 칸 이동
    var i = +e.target.dataset.i, d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[e.key];
    if (d === undefined) return;
    var j = i + d;
    if (j >= 0 && j < 81 && !(d === -1 && i % 9 === 0) && !(d === 1 && i % 9 === 8)) { e.preventDefault(); sd.cells[j].focus(); }
  }

  document.querySelectorAll('[data-level]').forEach(function (b) {
    b.addEventListener('click', function () {
      sd.level = b.dataset.level;
      document.querySelectorAll('[data-level]').forEach(function (x) { x.classList.toggle('on', x === b); });
      sdNew();
    });
  });
  $('sd-start').addEventListener('click', startGame);
  $('sd-new').addEventListener('click', sdNew);
  sdNew();
})();
