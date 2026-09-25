/* STEP·IGES 해석 워커 (클래식 워커). 화면이 멈추지 않도록 무거운 OpenCascade 계산을 여기서 한다.
   occt-import-js(LGPL-2.1)는 고치지 않고 그대로, 페이지가 넘겨 준 주소의 js·wasm 파일을 불러 쓴다.
   파일 내용은 이 브라우저 안에서만 다루고 네트워크로 보내지 않는다. */
let ready = null;

self.onmessage = async (ev) => {
  const { jsUrl, wasmUrl, format, buffer, params } = ev.data;
  try {
    if (!ready) {
      self.postMessage({ type: 'progress', stage: 'engine' });
      self.importScripts(jsUrl);
      ready = self.occtimportjs({ locateFile: (path) => (path.endsWith('.wasm') ? wasmUrl : path) });
    }
    const occt = await ready;
    self.postMessage({ type: 'progress', stage: 'parse' });
    const r = occt.ReadFile(format, new Uint8Array(buffer), params || null);
    if (!r || !r.success) { self.postMessage({ type: 'error', message: 'parse' }); return; }
    const transfer = [];
    const meshes = r.meshes.map((m) => {
      const position = Float32Array.from(m.attributes.position.array);
      const normal = m.attributes.normal ? Float32Array.from(m.attributes.normal.array) : null;
      const index = m.index ? Uint32Array.from(m.index.array) : null;
      transfer.push(position.buffer); if (normal) transfer.push(normal.buffer); if (index) transfer.push(index.buffer);
      return { name: m.name || '', color: m.color || null, position, normal, index };
    });
    self.postMessage({ type: 'done', result: { success: true, root: r.root, meshes } }, transfer);
  } catch (e) {
    ready = null; // 메모리가 모자라 실패했으면 다음 파일에서 새로 띄운다
    self.postMessage({ type: 'error', message: String((e && e.message) || e) });
  }
};
