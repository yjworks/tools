/* 끌어다 놓아 순서 바꾸기(마우스·손가락 공통, Pointer Events).
   - 마우스: 항목 아무 곳이나 잡고 6px 넘게 움직이면 끌기 시작(그냥 누르면 클릭)
   - 손가락: 손잡이(handle)를 잡아야 끌린다. 나머지 부분은 평소처럼 화면이 스크롤된다
   - 화면 위·아래 끝에 가까이 가면 저절로 스크롤
   onDrop(fromIndex, targetIndex): targetIndex 는 옮기기 전 목록 기준으로 "이 자리 앞에" 넣을 위치(0~length). */
export function sortable(container, { item, handle, axis = 'y', onDrop, onStart }) {
  let drag = null;

  const items = () => [...container.querySelectorAll(item)];

  function clear() {
    for (const el of container.querySelectorAll('.drop-before, .drop-after')) el.classList.remove('drop-before', 'drop-after');
  }

  function targetAt(x, y) {
    const list = items();
    let best = null, bestD = Infinity;
    for (const [i, el] of list.entries()) {
      const r = el.getBoundingClientRect();
      const inside = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      const cx = Math.max(r.left, Math.min(x, r.right)), cy = Math.max(r.top, Math.min(y, r.bottom));
      const d = inside ? 0 : Math.hypot(x - cx, y - cy);
      if (d < bestD) { bestD = d; best = { i, el, r }; }
    }
    if (!best || bestD > 80) return null;
    const after = axis === 'x' ? x > best.r.left + best.r.width / 2 : y > best.r.top + best.r.height / 2;
    return { el: best.el, index: best.i + (after ? 1 : 0), after };
  }

  function autoscroll() {
    if (!drag) return;
    const edge = 60, h = window.innerHeight;
    let dy = 0;
    if (drag.y < edge) dy = -Math.ceil((edge - drag.y) / 4);
    else if (drag.y > h - edge) dy = Math.ceil((drag.y - (h - edge)) / 4);
    if (dy && drag.active) { window.scrollBy(0, dy); move(drag.x, drag.y); }
    drag.raf = requestAnimationFrame(autoscroll);
  }

  function move(x, y) {
    drag.x = x; drag.y = y;
    if (!drag.active) return;
    drag.ghost.style.transform = `translate(${x - drag.ox}px, ${y - drag.oy}px)`;
    clear();
    const t = targetAt(x, y);
    drag.target = t;
    if (t) t.el.classList.add(t.after ? 'drop-after' : 'drop-before');
  }

  function start() {
    drag.active = true;
    onStart?.(drag.el);
    const r = drag.el.getBoundingClientRect();
    const g = drag.el.cloneNode(true);
    g.classList.add('drag-ghost');
    g.setAttribute('aria-hidden', 'true');
    Object.assign(g.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: 0, pointerEvents: 'none', zIndex: 50 });
    // 캔버스는 복제되면 비므로 그림을 옮겨 그린다
    const src = drag.el.querySelectorAll('canvas'), dst = g.querySelectorAll('canvas');
    src.forEach((c, i) => { try { dst[i].getContext('2d').drawImage(c, 0, 0); } catch { /* 빈 캔버스 */ } });
    document.body.append(g);
    drag.ghost = g;
    drag.ox = drag.sx; drag.oy = drag.sy;
    drag.el.classList.add('dragging');
    document.body.classList.add('is-dragging');
    drag.raf = requestAnimationFrame(autoscroll);
  }

  function end(commit) {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    const { active, target, from, el } = drag;
    drag.ghost?.remove();
    el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    clear();
    drag = null;
    if (active) {
      // 끌기 뒤 따라오는 click 은 무시
      const stop = (e) => { e.stopPropagation(); e.preventDefault(); };
      el.addEventListener('click', stop, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', stop, { capture: true }), 0);
      if (commit && target) onDrop(from, target.index);
    }
  }

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || drag) return;
    const el = e.target.closest(item);
    if (!el || !container.contains(el)) return;
    const onHandle = handle && e.target.closest(handle);
    if (e.pointerType !== 'mouse' && !onHandle) return;
    if (e.target.closest('button, input, select, a') && !onHandle) return;
    drag = { el, from: items().indexOf(el), sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, active: false, id: e.pointerId };
    if (onHandle) { e.preventDefault(); start(); }
    try { el.setPointerCapture(e.pointerId); } catch { /* 일부 브라우저 */ }
  });
  container.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) start();
    if (drag.active) { e.preventDefault(); move(e.clientX, e.clientY); }
  });
  container.addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag.id) end(true); });
  container.addEventListener('pointercancel', () => end(false));
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') end(false); });
}
