/* 도구 공통 UI 도우미. 파일은 절대 네트워크로 보내지 않는다. */
import './tool.css';

export const $ = (sel, root = document) => root.querySelector(sel);

/** 태그 만들기: h('button', {class: 'ghost', onclick}, '텍스트') */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : String(c));
  return el;
}

/** 끌어다 놓기 + 눌러서 고르기. dropEl 안에 <input type=file> 이 있어야 한다. */
export function fileDrop(dropEl, onFiles) {
  const input = dropEl.querySelector('input[type=file]');
  dropEl.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
  dropEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  dropEl.addEventListener('dragover', (e) => { e.preventDefault(); dropEl.classList.add('over'); });
  dropEl.addEventListener('dragleave', () => dropEl.classList.remove('over'));
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault(); dropEl.classList.remove('over');
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) onFiles(files);
  });
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

export function baseName(name) { return name.replace(/\.[^.]+$/, ''); }

export async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { const t = btn.textContent; btn.textContent = '복사됨'; setTimeout(() => (btn.textContent = t), 1200); }
  } catch { /* 권한이 없으면 사용자가 직접 복사한다 */ }
}

/** 이벤트 기록(GA). 파일 이름·내용은 절대 보내지 않는다. */
export function track(action, params = {}) {
  if (typeof window.gtag === 'function') window.gtag('event', action, params);
}
