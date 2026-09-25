import { zipSync } from 'fflate';
import { $, h, fileDrop, download, fmtBytes, setStatus, baseName, track } from '../_shared/ui.js';
import { readJpegExif, stripJpeg, stripPng, pngMetaChunks, isJpeg, isPng, redraw } from '../_shared/exif.js';

const list = $('#files'), status = $('#status'), actions = $('#actions');
let items = [];

async function inspect(file) {
  const buf = await file.arrayBuffer();
  const item = { file, buf, url: URL.createObjectURL(file), info: [], gps: null, mode: 'strip' };
  if (isJpeg(buf)) {
    const ex = readJpegExif(buf);
    if (ex) {
      item.gps = ex.gps;
      if (ex.make || ex.model) item.info.push([ex.make, ex.model].filter(Boolean).join(' '));
      if (ex.date) item.info.push(ex.date.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
      if (ex.software) item.info.push(ex.software);
      if (ex.orientation && ex.orientation !== 1) item.mode = 'redraw';
      item.hasMeta = true;
    }
  } else if (isPng(buf)) {
    const chunks = pngMetaChunks(buf);
    item.hasMeta = chunks.length > 0;
    if (chunks.length) item.info.push(`텍스트 정보 ${chunks.length}개`);
  } else {
    item.mode = 'redraw'; item.hasMeta = true; item.info.push('WEBP: 다시 저장');
  }
  return item;
}

function render() {
  list.replaceChildren();
  let withGps = 0;
  for (const it of items) {
    if (it.gps) withGps++;
    const tags = [];
    if (it.gps) tags.push(h('span', { class: 'tag warn', title: '이 좌표가 사진에 들어 있습니다' }, `📍 위치 ${it.gps.lat.toFixed(4)}, ${it.gps.lon.toFixed(4)}`));
    else if (it.hasMeta) tags.push(h('span', { class: 'tag' }, '위치정보 없음'));
    else tags.push(h('span', { class: 'tag ok' }, '지울 정보 없음'));
    if (it.mode === 'redraw' && isJpeg(it.buf)) tags.push(h('span', { class: 'tag' }, '방향 보정'));
    list.append(h('li', {},
      h('img', { src: it.url, alt: '' }),
      h('span', { class: 'name' }, it.file.name, h('br'), h('small', { class: 'muted' }, [fmtBytes(it.file.size), ...it.info].join(' · '))),
      ...tags));
  }
  actions.hidden = !items.length;
  $('#zipNote').textContent = items.length > 1 ? `${items.length}장을 ZIP 하나로 묶습니다` : '';
  setStatus(status, withGps ? `${items.length}장 중 ${withGps}장에 촬영 위치가 들어 있습니다.` : `${items.length}장 모두 위치정보가 없습니다. 기종·날짜 정보는 지울 수 있습니다.`, withGps ? 'warn' : 'ok');
}

async function clean(it) {
  if (it.mode === 'redraw') {
    const type = isPng(it.buf) ? 'image/png' : 'image/jpeg';
    const blob = await redraw(it.file, type, 0.92);
    return { name: `${baseName(it.file.name)}-clean.${type === 'image/png' ? 'png' : 'jpg'}`, bytes: new Uint8Array(await blob.arrayBuffer()) };
  }
  const bytes = isJpeg(it.buf) ? stripJpeg(it.buf) : stripPng(it.buf);
  const ext = isJpeg(it.buf) ? 'jpg' : 'png';
  return { name: `${baseName(it.file.name)}-clean.${ext}`, bytes };
}

$('#saveAll').addEventListener('click', async () => {
  setStatus(status, '정보를 지우는 중…');
  try {
    const outs = [];
    for (const it of items) outs.push(await clean(it));
    if (outs.length === 1) download(new Blob([outs[0].bytes], { type: isPng(items[0].buf) ? 'image/png' : 'image/jpeg' }), outs[0].name);
    else {
      const files = {};
      for (const o of outs) { let n = o.name, i = 2; while (files[n]) n = o.name.replace(/(\.\w+)$/, `-${i++}$1`); files[n] = [o.bytes, { level: 0 }]; }
      download(new Blob([zipSync(files)], { type: 'application/zip' }), 'photos-clean.zip');
    }
    setStatus(status, `${outs.length}장에서 정보를 지워 저장했습니다.`, 'ok');
    track('tool_download', { tool: 'exif-remove', files: outs.length });
  } catch (e) {
    setStatus(status, `처리하지 못했습니다: ${e.message}`, 'bad');
  }
});

fileDrop($('.drop'), async (files) => {
  items.forEach((it) => URL.revokeObjectURL(it.url));
  const imgs = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
  if (!imgs.length) { setStatus(status, 'JPG·PNG·WEBP 사진만 넣을 수 있습니다.', 'warn'); return; }
  items = await Promise.all(imgs.map(inspect));
  render();
  track('tool_use', { tool: 'exif-remove', files: items.length, gps: items.filter((i) => i.gps).length });
});
