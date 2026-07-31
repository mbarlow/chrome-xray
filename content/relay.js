// chrome-xray isolated-world relay. Bridges the MAIN-world shim to the
// service worker, and carries activation state changes back to the shim.
(() => {
  const SRC = 'chrome-xray';
  const CTL = 'chrome-xray-ctl';

  function tellShim(kind, extra) {
    window.postMessage({ source: CTL, kind, ...extra }, '*');
  }

  // Ask the SW whether an enabled profile matches this URL.
  function sync() {
    chrome.runtime.sendMessage({ type: 'xray:hello', url: location.href }).then((res) => {
      if (res && res.active) tellShim('enable', { bodyCap: res.bodyCap });
      else tellShim('disable');
    }).catch(() => tellShim('disable'));
  }
  sync();

  // Shim -> SW entry forwarding.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC) return;
    if (e.data.kind !== 'entry') return;
    chrome.runtime.sendMessage({ type: 'xray:entry', entry: e.data.entry, url: location.href }).catch(() => {});
  });

  // SW -> shim state changes (activate/deactivate while the page is open).
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'xray:state-changed') sync();
  });
})();
