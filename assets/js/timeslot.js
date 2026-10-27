/* timeslot.js — KLID ITSM 목업 공통 시간대 선택 위젯 (SSOT: docs/style-guide.md §18)
 *
 * 의존성 없음(순수 JS). 페이지에 <script src="../assets/js/timeslot.js" defer></script>
 * 한 줄을 넣으면, 그 페이지의 모든 시간대 컴포넌트에 자동으로 붙는다.
 *
 * 0시~23시(1시간 단위 24칸) 중 **여러 개**를 골라 담는 컴포넌트.
 *   <div class="input-wrap" data-timeslot data-min="2">      ← data-min = 최소 선택 개수(기본 1)
 *     <input class="field" id="focusHours" readonly placeholder="시간대 선택">
 *     <button class="icon-btn" title="시간대">🕒</button>
 *   </div>
 * 열기 : 🕒 버튼 클릭 · 입력칸 클릭
 * 선택 : 칸 클릭 = 토글 · 누른 채 드래그 = 연속 칠하기(첫 칸의 반대 상태로) · 행 라벨 클릭 = 그 행 전체 토글
 * 닫기 : 바깥 클릭 · Esc · [닫기] · 같은 버튼 재클릭
 * 값   : input.dataset.hours = "9,10,11,14" (오름차순 시각 목록)
 *        input.value          = "09:00~12:00, 14:00~15:00 (4개)"  ← 연속 구간을 묶어 표시
 *        변경 시 input/change 이벤트 발생
 * API  : TimeSlot.get(input) → [9,10,11,14]  ·  TimeSlot.set(input, [..])  ·  TimeSlot.min(input) → n
 *
 * 팝오버는 body 직속 · position:fixed (datepicker 와 동일 규칙, 모달 위에서도 잘리지 않음).
 */
(function () {
  'use strict';

  var GAP = 2, VIEW_PAD = 4;
  /* 12시간씩 2행 — 행 라벨은 오전(00~11)/오후(12~23) */
  var ROWS = [['오전', 0], ['오후', 12]];
  var PER_ROW = 12;

  var pop = null, target = null, anchor = null;
  var drag = null;          /* 드래그 칠하기 중이면 true/false(칠할 상태), 아니면 null */

  function p2(n) { return ('0' + n).slice(-2); }

  function wrapOf(el) { return el && el.closest ? el.closest('[data-timeslot]') : null; }
  function inputOf(wrap) { return wrap ? wrap.querySelector('input.field') : null; }
  function editable(el) { return el && !el.disabled && !wrapOf(el).hasAttribute('data-disabled'); }

  function get(input) {
    var s = (input && input.dataset.hours) || '';
    return s ? s.split(',').map(Number).sort(function (a, b) { return a - b; }) : [];
  }
  function min(input) {
    var w = wrapOf(input), n = w ? +w.getAttribute('data-min') : 0;
    return n > 0 ? n : 1;
  }

  /* [9,10,11,14] → "09:00~12:00, 14:00~15:00 (4개)" */
  function label(hours) {
    if (!hours.length) return '';
    var parts = [], st = hours[0], prev = hours[0];
    for (var i = 1; i <= hours.length; i++) {
      var h = hours[i];
      if (h === prev + 1) { prev = h; continue; }
      parts.push(p2(st) + ':00~' + p2(prev + 1) + ':00');
      st = prev = h;
    }
    return parts.join(', ') + ' (' + hours.length + '개)';
  }

  function set(input, hours, silent) {
    var uniq = {};
    hours.forEach(function (h) { h = +h; if (h >= 0 && h <= 23) uniq[h] = 1; });
    var list = Object.keys(uniq).map(Number).sort(function (a, b) { return a - b; });
    input.dataset.hours = list.join(',');
    input.value = label(list);
    input.title = input.value;
    if (!silent) {
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /* ── 팝오버 ─────────────────────────────────────────────── */
  function build() {
    pop = document.createElement('div');
    pop.className = 'tp';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '시간대 선택');
    var body = ROWS.map(function (r) {
      var cells = '';
      for (var h = r[1]; h < r[1] + PER_ROW; h++) {
        cells += '<td class="tp-cell" data-h="' + h + '">' + p2(h) + '</td>';
      }
      return '<tr><th class="tp-row" data-row="' + r[1] + '" title="' + r[0] + ' 전체 토글">' + r[0] + '</th>' + cells + '</tr>';
    }).join('');
    pop.innerHTML =
      '<div class="tp-head"><span class="tp-title">시간대 선택</span><span class="tp-count"></span></div>' +
      '<table class="tp-grid"><tbody>' + body + '</tbody></table>' +
      '<div class="tp-foot">' +
        '<button type="button" class="dp-act" data-act="all">전체</button>' +
        '<button type="button" class="dp-act" data-act="clear">지우기</button>' +
        '<button type="button" class="dp-act" data-act="close">닫기</button>' +
      '</div>';
    document.body.appendChild(pop);

    pop.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var cell = e.target.closest('.tp-cell');
      if (!cell || !target) return;
      var h = +cell.dataset.h, cur = get(target);
      drag = cur.indexOf(h) < 0;         /* 비어 있던 칸에서 시작하면 칠하기, 찬 칸이면 지우기 */
      paint(h);
    });
    pop.addEventListener('mouseover', function (e) {
      if (drag === null) return;
      var cell = e.target.closest('.tp-cell');
      if (cell) paint(+cell.dataset.h);
    });
    pop.addEventListener('click', function (e) {
      var row = e.target.closest('.tp-row');
      if (row && target) {
        var base = +row.dataset.row, cur = get(target), hs = [], i;
        for (i = base; i < base + PER_ROW; i++) hs.push(i);
        var full = hs.every(function (x) { return cur.indexOf(x) > -1; });
        set(target, full ? cur.filter(function (x) { return hs.indexOf(x) < 0; }) : cur.concat(hs));
        render(); return;
      }
      var act = e.target.closest('.dp-act');
      if (!act || !target) return;
      var a = act.getAttribute('data-act');
      if (a === 'all') { var all = []; for (var k = 0; k < 24; k++) all.push(k); set(target, all); render(); }
      else if (a === 'clear') { set(target, []); render(); }
      else close();
    });
  }

  function paint(h) {
    var cur = get(target), has = cur.indexOf(h) > -1;
    if (drag && !has) cur.push(h);
    else if (!drag && has) cur = cur.filter(function (x) { return x !== h; });
    else return;
    set(target, cur); render();
  }

  function render() {
    var cur = get(target), n = min(target);
    Array.prototype.forEach.call(pop.querySelectorAll('.tp-cell'), function (c) {
      c.classList.toggle('on', cur.indexOf(+c.dataset.h) > -1);
    });
    var cnt = pop.querySelector('.tp-count');
    cnt.textContent = cur.length + '개 선택 · 최소 ' + n + '개';
    cnt.classList.toggle('is-short', cur.length < n);
  }

  function place() {
    var r = anchor.getBoundingClientRect();
    pop.style.visibility = 'hidden'; pop.style.display = 'block';
    var w = pop.offsetWidth, h = pop.offsetHeight;
    var top = r.bottom + GAP;
    if (top + h > window.innerHeight - VIEW_PAD && r.top - GAP - h > VIEW_PAD) top = r.top - GAP - h;
    top = Math.max(VIEW_PAD, Math.min(top, window.innerHeight - h - VIEW_PAD));
    var left = Math.max(VIEW_PAD, Math.min(r.left, window.innerWidth - w - VIEW_PAD));
    pop.style.top = top + 'px'; pop.style.left = left + 'px'; pop.style.visibility = '';
  }

  function open(input, anc) {
    if (!editable(input)) return;
    if (!pop) build();
    target = input; anchor = anc || input;
    render(); pop.classList.add('is-open'); place();
  }
  function close() {
    if (pop) { pop.classList.remove('is-open'); pop.style.display = ''; }
    target = null; anchor = null; drag = null;
  }

  /* ── 전역 바인딩 (이벤트 위임) ─────────────────────────── */
  document.addEventListener('mouseup', function () { drag = null; });

  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) { close(); return; }
    var wrap = wrapOf(e.target);
    if (wrap && (e.target.closest('button.icon-btn') || e.target.closest('input.field'))) {
      e.preventDefault();
      var input = inputOf(wrap);
      if (target === input) close(); else open(input, wrap);
      return;
    }
    if (pop && !pop.contains(e.target)) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && target) { var t = target; close(); t.focus(); }
  });

  window.addEventListener('scroll', function () { if (target) place(); }, true);
  window.addEventListener('resize', function () { if (target) close(); });

  /* 마크업의 data-hours 초기값을 표시 문자열로 반영 */
  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-timeslot] input.field'), function (i) {
      i.readOnly = true;
      set(i, get(i), true);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.TimeSlot = { get: get, set: function (i, h) { set(i, h); }, min: min, label: label };
})();
