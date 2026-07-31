// chrome-xray MAIN-world shim. Wraps window.fetch and XMLHttpRequest,
// emits capture entries to the isolated relay via postMessage.
// Dormant until the relay enables it; early calls buffer until the
// activation decision arrives, then flush or drop.
(() => {
  if (window.__XRAY_SHIM__) return;
  window.__XRAY_SHIM__ = true;

  const SRC = 'chrome-xray';
  const CTL = 'chrome-xray-ctl';
  const BUFFER_MAX = 300;

  let enabled = false;
  let decided = false;
  let bodyCap = 262144; // 256 KiB per body
  let buffer = [];

  function emit(entry) {
    if (enabled) {
      window.postMessage({ source: SRC, kind: 'entry', entry }, '*');
    } else if (!decided && buffer.length < BUFFER_MAX) {
      buffer.push(entry);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== CTL) return;
    if (e.data.kind === 'enable') {
      decided = true;
      enabled = true;
      if (e.data.bodyCap) bodyCap = e.data.bodyCap;
      const held = buffer;
      buffer = [];
      for (const entry of held) {
        window.postMessage({ source: SRC, kind: 'entry', entry }, '*');
      }
    } else if (e.data.kind === 'disable') {
      decided = true;
      enabled = false;
      buffer = [];
    }
  });

  function uid() {
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function cap(text) {
    if (typeof text !== 'string') return { body: null, truncated: false };
    if (text.length > bodyCap) return { body: text.slice(0, bodyCap), truncated: true };
    return { body: text, truncated: false };
  }

  function absolute(url) {
    try { return new URL(url, location.href).href; } catch { return String(url); }
  }

  // Serialize a fetch/XHR request body into something storable.
  function serializeBody(body) {
    if (body == null) return { body: null, truncated: false, note: null };
    if (typeof body === 'string') return { ...cap(body), note: null };
    if (body instanceof URLSearchParams) return { ...cap(body.toString()), note: 'URLSearchParams' };
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const parts = [];
      for (const [k, v] of body.entries()) {
        parts.push(v instanceof File ? `${k}=[File ${v.name} ${v.size}B ${v.type}]` : `${k}=${String(v)}`);
      }
      return { ...cap(parts.join('\n')), note: 'FormData' };
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      return { body: null, truncated: false, note: `Blob ${body.size}B ${body.type || 'unknown'}` };
    }
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
      return { body: null, truncated: false, note: `binary ${body.byteLength}B` };
    }
    try { return { ...cap(String(body)), note: typeof body }; }
    catch { return { body: null, truncated: false, note: 'unserializable' }; }
  }

  function headersToObj(headers) {
    const out = {};
    try {
      if (!headers) return out;
      if (typeof headers.forEach === 'function') {
        headers.forEach((v, k) => { out[String(k).toLowerCase()] = String(v); });
      } else if (Array.isArray(headers)) {
        for (const [k, v] of headers) out[String(k).toLowerCase()] = String(v);
      } else {
        for (const k of Object.keys(headers)) out[k.toLowerCase()] = String(headers[k]);
      }
    } catch { /* ignore */ }
    return out;
  }

  function isTextLike(contentType) {
    if (!contentType) return true; // assume text when unlabeled
    const ct = contentType.toLowerCase();
    return ct.includes('json') || ct.startsWith('text/') || ct.includes('xml') ||
      ct.includes('javascript') || ct.includes('x-www-form-urlencoded') ||
      ct.includes('graphql') || ct.includes('csv');
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let entry;
    try {
      const isReq = typeof Request !== 'undefined' && input instanceof Request;
      const url = absolute(isReq ? input.url : input);
      if (!/^https?:/.test(url)) return origFetch.call(this, input, init);

      const method = ((init && init.method) || (isReq && input.method) || 'GET').toUpperCase();
      const reqHeaders = headersToObj((init && init.headers) || (isReq && input.headers) || null);
      let reqBody = { body: null, truncated: false, note: null };
      if (init && init.body != null) reqBody = serializeBody(init.body);
      // Request-object bodies are streams; note their presence without consuming.
      else if (isReq && input.body != null) reqBody = { body: null, truncated: false, note: 'stream (Request body)' };

      entry = {
        id: uid(),
        api: 'fetch',
        method,
        url,
        pageUrl: location.href,
        reqHeaders,
        reqBody: reqBody.body,
        reqBodyNote: reqBody.note,
        reqBodyTruncated: reqBody.truncated,
        startedAt: Date.now(),
        replayed: window.__xrayReplay === true,
      };
    } catch {
      return origFetch.call(this, input, init);
    }

    const t0 = performance.now();
    return origFetch.call(this, input, init).then(
      (response) => {
        try {
          const resHeaders = headersToObj(response.headers);
          const base = {
            ...entry,
            status: response.status,
            statusText: response.statusText,
            resHeaders,
            durationMs: Math.round(performance.now() - t0),
          };
          const ct = resHeaders['content-type'] || '';
          if (isTextLike(ct)) {
            response.clone().text().then((text) => {
              const capped = cap(text);
              emit({ ...base, resBody: capped.body, resBodyTruncated: capped.truncated, resBodySize: text.length });
            }).catch(() => emit({ ...base, resBody: null, resBodyNote: 'unreadable' }));
          } else {
            emit({ ...base, resBody: null, resBodyNote: ct || 'binary' });
          }
        } catch { /* never break the page */ }
        return response;
      },
      (err) => {
        try {
          emit({ ...entry, error: String(err && err.message || err), durationMs: Math.round(performance.now() - t0) });
        } catch { /* ignore */ }
        throw err;
      }
    );
  };

  // ---- XMLHttpRequest ----
  const XHR = XMLHttpRequest.prototype;
  const origOpen = XHR.open;
  const origSetHeader = XHR.setRequestHeader;
  const origSend = XHR.send;

  XHR.open = function (method, url, ...rest) {
    try {
      this.__xray = {
        method: String(method || 'GET').toUpperCase(),
        url: absolute(url),
        reqHeaders: {},
      };
    } catch { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };

  XHR.setRequestHeader = function (name, value) {
    try {
      if (this.__xray) this.__xray.reqHeaders[String(name).toLowerCase()] = String(value);
    } catch { /* ignore */ }
    return origSetHeader.call(this, name, value);
  };

  XHR.send = function (body) {
    const meta = this.__xray;
    if (meta && /^https?:/.test(meta.url)) {
      const reqBody = serializeBody(body);
      const t0 = performance.now();
      const entry = {
        id: uid(),
        api: 'xhr',
        method: meta.method,
        url: meta.url,
        pageUrl: location.href,
        reqHeaders: meta.reqHeaders,
        reqBody: reqBody.body,
        reqBodyNote: reqBody.note,
        reqBodyTruncated: reqBody.truncated,
        startedAt: Date.now(),
        replayed: window.__xrayReplay === true,
      };
      this.addEventListener('loadend', () => {
        try {
          const done = {
            ...entry,
            durationMs: Math.round(performance.now() - t0),
          };
          if (this.status === 0) {
            emit({ ...done, error: 'network error or aborted' });
            return;
          }
          done.status = this.status;
          done.statusText = this.statusText;
          const resHeaders = {};
          for (const line of (this.getAllResponseHeaders() || '').trim().split(/[\r\n]+/)) {
            const i = line.indexOf(': ');
            if (i > 0) resHeaders[line.slice(0, i).toLowerCase()] = line.slice(i + 2);
          }
          done.resHeaders = resHeaders;
          const rt = this.responseType;
          if (rt === '' || rt === 'text') {
            const capped = cap(this.responseText);
            done.resBody = capped.body;
            done.resBodyTruncated = capped.truncated;
            done.resBodySize = this.responseText.length;
          } else if (rt === 'json') {
            try {
              const text = JSON.stringify(this.response);
              const capped = cap(text);
              done.resBody = capped.body;
              done.resBodyTruncated = capped.truncated;
              done.resBodySize = text.length;
            } catch { done.resBodyNote = 'json (unserializable)'; }
          } else {
            done.resBodyNote = rt;
          }
          emit(done);
        } catch { /* never break the page */ }
      });
    }
    return origSend.call(this, body);
  };
})();
