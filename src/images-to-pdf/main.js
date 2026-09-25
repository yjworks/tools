import { PDFDocument } from 'pdf-lib';
import { $, h, fileDrop, download, fmtBytes, setStatus, track } from '../_shared/ui.js';
import { readJpegExif, isJpeg, isPng, redraw } from '../_shared/exif.js';

const list = $('#files'), status = $('#status'), make = $('#make'), clear = $('#clear');
let items = [];

const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };

function render() {
  list.replaceChildren();
  items.forEach((it, i) => {
    const up = h('button', { class: 'small ghost', title: '앞으로', disabled: i === 0, onclick: () => move(i, -1) }, '▲');
    const down = h('button', { class: 'small ghost', title: '뒤로', disabled: i === items.length - 1, onclick: () => move(i, 1) }, '▼');
    const del = h('button', { class: 'small ghost', title: '빼기', onclick: () => { URL.revokeObjectURL(it.url); items.splice(i, 1); render(); } }, '✕');
    list.append(h('li', {}, h('span', { class: 'tag' }, String(i + 1)), h('img', { src: it.url, alt: '' }),
      h('span', { class: 'name' }, it.file.name, h('br'), h('small', { class: 'muted' }, fmtBytes(it.file.size))), up, down, del));
  });
  make.disabled = !items.length;
  clear.hidden = !items.length;
  setStatus(status, items.length ? `${items.length}장` : '');
}
function move(i, d) { const [x] = items.splice(i, 1); items.splice(i + d, 0, x); render(); }

async function embed(pdf, it) {
  const buf = await it.file.arrayBuffer();
  if (isJpeg(buf)) {
    const ex = readJpegExif(buf);
    if (!ex || !ex.orientation || ex.orientation === 1) return pdf.embedJpg(buf);   // 다시 압축하지 않는다
    return pdf.embedJpg(await (await redraw(it.file, 'image/jpeg', 0.92)).arrayBuffer());
  }
  if (isPng(buf)) return pdf.embedPng(buf);
  return pdf.embedJpg(await (await redraw(it.file, 'image/jpeg', 0.92)).arrayBuffer());
}

make.addEventListener('click', async () => {
  make.disabled = true;
  try {
    const pdf = await PDFDocument.create();
    const size = $('#size').value, margin = Number($('#margin').value);
    for (let i = 0; i < items.length; i++) {
      setStatus(status, `${i + 1} / ${items.length}장 넣는 중…`);
      const img = await embed(pdf, items[i]);
      let pw, ph;
      if (size === 'image') { pw = img.width * 0.75 + margin * 2; ph = img.height * 0.75 + margin * 2; }
      else { [pw, ph] = PAGE[size]; if (img.width > img.height) [pw, ph] = [ph, pw]; }
      const page = pdf.addPage([pw, ph]);
      const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
      const w = img.width * s, hgt = img.height * s;
      page.drawImage(img, { x: (pw - w) / 2, y: (ph - hgt) / 2, width: w, height: hgt });
    }
    pdf.setProducer('DigitalBrain 도구 (dibrain.dev/tools)');
    const bytes = await pdf.save();
    const name = ($('#fname').value.trim() || '사진모음').replace(/[\\/:*?"<>|]/g, '_');
    download(new Blob([bytes], { type: 'application/pdf' }), `${name}.pdf`);
    setStatus(status, `PDF를 만들었습니다 (${items.length}쪽, ${fmtBytes(bytes.length)}).`, 'ok');
    track('tool_download', { tool: 'images-to-pdf', pages: items.length });
  } catch (e) {
    setStatus(status, `만들지 못했습니다: ${e.message}`, 'bad');
  } finally { make.disabled = !items.length; }
});

clear.addEventListener('click', () => { items.forEach((it) => URL.revokeObjectURL(it.url)); items = []; render(); });

fileDrop($('.drop'), (files) => {
  const imgs = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
  if (!imgs.length) { setStatus(status, 'JPG·PNG·WEBP 사진만 넣을 수 있습니다.', 'warn'); return; }
  items.push(...imgs.map((file) => ({ file, url: URL.createObjectURL(file) })));
  render();
  track('tool_use', { tool: 'images-to-pdf', files: imgs.length });
});
