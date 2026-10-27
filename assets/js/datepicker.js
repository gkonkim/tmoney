/* datepicker.js — KLID ITSM 목업 공통 달력 위젯 (SSOT: docs/style-guide.md §17)
 *
 * 의존성 없음(순수 JS). 페이지에 <script src="../assets/js/datepicker.js" defer></script>
 * 한 줄만 넣으면, 그 페이지의 모든 날짜 컴포넌트에 자동으로 달력이 붙는다.
 *
 * 대상 판별 — 마크업 변경 없이 기존 47개 날짜 컴포넌트를 그대로 인식한다.
 *   <div class="input-wrap">
 *     <input class="field" value="2026-07-11">
 *     <button class="icon-btn" title="달력">📅</button>   ← 이 버튼 (title 없이 📅 만 있어도 인식)
 *   </div>
 * 열기 : 📅 버튼 클릭 · 날짜 입력칸 클릭(직접 타이핑도 그대로 가능)
 * 닫기 : 날짜 선택 · 바깥 클릭 · Esc
 * 값   : YYYY-MM-DD 로 넣고 input/change 이벤트를 발생시킨다
 *        (화면별 DATE_RE 검증·집계 갱신 로직이 그대로 동작하도록)
 *
 * 팝오버는 body 직속 · position:fixed 라서 모달(z-index 1000) 위에서도, 스크롤 영역
 * (.grid-scroll) 안에서도 잘리지 않는다. iframe 하단에 걸리면 위로 뒤집어 띄운다.
 */
(function () {
  'use strict';

  var DATE_RE  = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DOW      = ['일', '월', '화', '수', '목', '금', '토'];
  var GAP      = 2;      /* 필드와 팝오버 사이 간격(px) */
  var VIEW_PAD = 4;      /* 뷰포트 가장자리 최소 여백(px) */

  var pop = null;        /* 팝오버 DOM (지연 생성 · 문서당 1개 재사용) */
  var target = null;     /* 현재 열려 있는 대상 input */
  var anchor = null;     /* 위치 기준 요소(📅 버튼 또는 input) */
  var viewY, viewM;      /* 현재 보고 있는 연/월 */

  /* ── 유틸 ───────────────────────────────────────────────── */
  function p2(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }

  /* 'YYYY-MM-DD' → Date. 형식이 틀리거나 존재하지 않는 날짜(2026-02-31 등)면 null */
  function parse(s) {
    var m = DATE_RE.exec(String(s || '').trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    var dt = new Date(y, mo, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  /* 달력 버튼인가 — title="달력" 이거나 📅 글리프를 가진 .icon-btn */
  function isCalBtn(el) {
    return !!el && el.classList.contains('icon-btn') &&
           (el.getAttribute('title') === '달력' || el.textContent.indexOf('📅') > -1);
  }

  /* 달력 버튼에 딸린 날짜 input 찾기 — 바로 앞 형제 우선, 없으면 같은 묶음의 첫 텍스트 input */
  function inputOf(btn) {
    var prev = btn.previousElementSibling;
    if (prev && prev.tagName === 'INPUT' && prev.type !== 'hidden') return prev;
    var wrap = btn.parentElement;
    return wrap ? wrap.querySelector('input.field:not(.field--time)') : null;
  }

  /* 날짜 input 인가 — 같은 묶음 안에 📅 버튼이 있는 텍스트 input */
  function isDateInput(el) {
    if (!el || el.tagName !== 'INPUT' || (el.type && el.type !== 'text')) return false;
    var wrap = el.parentElement;
    if (!wrap) return false;
    var btns = wrap.querySelectorAll('button.icon-btn');
    for (var i = 0; i < btns.length; i++) { if (isCalBtn(btns[i]) && inputOf(btns[i]) === el) return true; }
    return false;
  }

  function editable(el) { return el && !el.readOnly && !el.disabled; }

  /* ── 팝오버 생성 ─────────────────────────────────────────── */
  function build() {
    pop = document.createElement('div');
    pop.className = 'dp';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', '날짜 선택');
    pop.innerHTML =
      '<div class="dp-head">' +
        '<button type="button" class="dp-nav" data-mv="-12" title="이전 해">&laquo;</button>' +
        '<button type="button" class="dp-nav" data-mv="-1"  title="이전 달">&lsaquo;</button>' +
        '<span class="dp-title"></span>' +
        '<button type="button" class="dp-nav" data-mv="1"   title="다음 달">&rsaquo;</button>' +
        '<button type="button" class="dp-nav" data-mv="12"  title="다음 해">&raquo;</button>' +
      '</div>' +
      '<table class="dp-grid"><thead><tr>' +
        DOW.map(function (d, i) {
          return '<th' + (i === 0 ? ' class="sun"' : i === 6 ? ' class="sat"' : '') + '>' + d + '</th>';
        }).join('') +
      '</tr></thead><tbody></tbody></table>' +
      '<div class="dp-foot">' +
        '<button type="button" class="dp-act" data-act="today">오늘</button>' +
        '<button type="button" class="dp-act" data-act="clear">지우기</button>' +
        '<button type="button" class="dp-act" data-act="close">닫기</button>' +
      '</div>';
    document.body.appendChild(pop);

    /* 팝오버 내부 클릭이 바깥클릭(닫기)으로 새지 않게 */
    pop.addEventListener('mousedown', function (e) { e.preventDefault(); });

    pop.addEventListener('click', function (e) {
      var nav = e.target.closest('.dp-nav');
      if (nav) { shift(+nav.getAttribute('data-mv')); return; }

      var act = e.target.closest('.dp-act');
      if (act) {
        var a = act.getAttribute('data-act');
        if (a === 'today') { pick(new Date()); }
        else if (a === 'clear') { commit(''); close(); }
        else { close(); }
        return;
      }

      var cell = e.target.closest('.dp-day');
      if (cell) pick(new Date(+cell.dataset.y, +cell.dataset.m, +cell.dataset.d));
    });
  }

  function shift(months) {
    var d = new Date(viewY, viewM + months, 1);
    viewY = d.getFullYear(); viewM = d.getMonth();
    render();
  }

  /* ── 렌더 ───────────────────────────────────────────────── */
  function render() {
    pop.querySelector('.dp-title').textContent = viewY + '년 ' + (viewM + 1) + '월';

    var sel   = parse(target && target.value);
    var selS  = sel ? ymd(sel) : '';
    var todayS = ymd(new Date());

    var first = new Date(viewY, viewM, 1);
    var cur   = new Date(viewY, viewM, 1 - first.getDay());   /* 그 주 일요일부터 */
    var html  = '';

    for (var w = 0; w < 6; w++) {
      html += '<tr>';
      for (var i = 0; i < 7; i++) {
        var s = ymd(cur), cls = 'dp-day';
        if (cur.getMonth() !== viewM) cls += ' out';
        if (i === 0) cls += ' sun'; else if (i === 6) cls += ' sat';
        if (s === todayS) cls += ' today';
        if (s && s === selS) cls += ' on';
        html += '<td class="' + cls + '" data-y="' + cur.getFullYear() +
                '" data-m="' + cur.getMonth() + '" data-d="' + cur.getDate() + '">' +
                cur.getDate() + '</td>';
        cur.setDate(cur.getDate() + 1);
      }
      html += '</tr>';
    }
    pop.querySelector('tbody').innerHTML = html;
  }

  /* 앵커 기준 위치 — 아래 공간이 모자라면 위로 뒤집고, 좌우는 뷰포트 안으로 밀어 넣는다 */
  function place() {
    var r = anchor.getBoundingClientRect();
    pop.style.visibility = 'hidden';
    pop.style.display = 'block';
    var w = pop.offsetWidth, h = pop.offsetHeight;

    var top = r.bottom + GAP;
    if (top + h > window.innerHeight - VIEW_PAD && r.top - GAP - h > VIEW_PAD) top = r.top - GAP - h;
    top = Math.max(VIEW_PAD, Math.min(top, window.innerHeight - h - VIEW_PAD));

    var left = Math.min(r.left, window.innerWidth - w - VIEW_PAD);
    left = Math.max(VIEW_PAD, left);

    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
    pop.style.visibility = '';
  }

  /* ── 열기/닫기/선택 ─────────────────────────────────────── */
  function open(input, anc) {
    if (!editable(input)) return;
    if (!pop) build();
    target = input; anchor = anc || input;

    var d = parse(input.value) || new Date();
    viewY = d.getFullYear(); viewM = d.getMonth();

    render();
    pop.classList.add('is-open');
    place();
  }

  function close() {
    if (pop) { pop.classList.remove('is-open'); pop.style.display = ''; }
    target = null; anchor = null;
  }

  function commit(value) {
    if (!target) return;
    target.value = value;
    /* 화면별 검증·집계 로직이 직접 입력과 똑같이 반응하도록 두 이벤트 모두 발생 */
    target.dispatchEvent(new Event('input',  { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function pick(date) {
    var t = target;
    commit(ymd(date));
    close();
    if (t) t.focus();
  }

  /* ── 전역 바인딩 (이벤트 위임 — 나중에 동적으로 추가된 폼에도 그대로 적용) ── */
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) { close(); return; }
    var btn = e.target.closest('button.icon-btn');
    if (btn && isCalBtn(btn)) {
      e.preventDefault();          /* form 안의 button 기본 submit 방지 */
      var input = inputOf(btn);
      if (!input) return;
      if (target === input) close();          /* 같은 버튼 다시 누르면 토글 */
      else open(input, btn);
      return;
    }

    if (isDateInput(e.target)) { open(e.target, e.target); return; }

    if (pop && !pop.contains(e.target)) close();   /* 바깥 클릭 */
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && target) { var t = target; close(); t.focus(); }
  });

  /* 열려 있는 동안 타이핑하면 달력도 그 달로 따라간다 */
  document.addEventListener('input', function (e) {
    if (!target || e.target !== target) return;
    var d = parse(target.value);
    if (d) { viewY = d.getFullYear(); viewM = d.getMonth(); render(); }
  });

  /* 스크롤/리사이즈 시 위치 재계산 (capture: .grid-scroll 등 내부 스크롤도 잡는다) */
  window.addEventListener('scroll', function () { if (target) place(); }, true);
  window.addEventListener('resize', function () { if (target) close(); });
})();
