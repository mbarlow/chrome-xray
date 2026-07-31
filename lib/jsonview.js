// chrome-xray JSON viewer: pretty-printed, syntax-colored, collapsible DOM
// rendering. No innerHTML of payload data — everything is text nodes.

import { el } from './util.js';

const COLLAPSE_OVER = 30; // auto-collapse containers with more children than this

function span(cls, text) {
  return el('span', { class: cls }, text);
}

function renderValue(value, depth) {
  if (value === null) return span('tok-null', 'null');
  switch (typeof value) {
    case 'string': return span('tok-str', JSON.stringify(value));
    case 'number': return span('tok-num', String(value));
    case 'boolean': return span('tok-bool', String(value));
    default: break;
  }
  if (Array.isArray(value)) return renderContainer(value, depth, '[', ']', (v, i) => [null, v]);
  return renderContainer(Object.entries(value), depth, '{', '}', (pair) => pair);
}

function renderContainer(items, depth, open, close, keyVal) {
  const wrap = el('span', { class: 'tok-container' });
  const count = items.length;
  if (count === 0) {
    wrap.append(span('tok-punct', open + close));
    return wrap;
  }

  const toggle = el('span', { class: 'tok-toggle', title: 'Collapse/expand' }, '▾');
  const body = el('div', { class: 'tok-body' });
  const ellipsis = span('tok-ellipsis', `… ${count} ${open === '[' ? 'items' : 'keys'} …`);
  ellipsis.style.display = 'none';

  let i = 0;
  for (const item of items) {
    const [key, v] = keyVal(item, i);
    const line = el('div', { class: 'tok-line' });
    if (key !== null && key !== undefined) {
      line.append(span('tok-key', JSON.stringify(key)), span('tok-punct', ': '));
    }
    line.append(renderValue(v, depth + 1));
    if (i < count - 1) line.append(span('tok-punct', ','));
    body.append(line);
    i++;
  }

  let collapsed = false;
  const setCollapsed = (c) => {
    collapsed = c;
    body.style.display = c ? 'none' : '';
    ellipsis.style.display = c ? '' : 'none';
    toggle.textContent = c ? '▸' : '▾';
  };
  toggle.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(!collapsed); });
  ellipsis.addEventListener('click', (e) => { e.stopPropagation(); setCollapsed(false); });

  wrap.append(toggle, span('tok-punct', open), ellipsis, body, span('tok-punct', close));
  if (count > COLLAPSE_OVER && depth > 0) setCollapsed(true);
  return wrap;
}

// Render text as colorized JSON if it parses, else as plain <pre>.
// Returns { node, isJSON, pretty } — pretty is the formatted text for copying.
export function renderBody(text, contentType = '') {
  if (text == null || text === '') {
    return { node: el('div', { class: 'body-empty' }, '∅ empty'), isJSON: false, pretty: '' };
  }
  const trimmed = text.trim();
  const looksJSON = contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[');
  if (looksJSON) {
    try {
      const value = JSON.parse(trimmed);
      const pretty = JSON.stringify(value, null, 2);
      const node = el('div', { class: 'jsonview' }, renderValue(value, 0));
      return { node, isJSON: true, pretty };
    } catch { /* fall through to plain */ }
  }
  const node = el('pre', { class: 'body-plain' }, text);
  return { node, isJSON: false, pretty: text };
}
