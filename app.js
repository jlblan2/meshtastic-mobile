// Meshtastic Mobile: the screens. radio.js does the talking to the radio.
(function () {
  'use strict';
  const APP_VERSION = '1.0.1';
  const GUIDE_URL = 'Meshtastic%20Mobile%20Guide.pdf';    // built by tools/make_guide.py
  const $ = (id) => document.getElementById(id);
  const BROADCAST = Radio.BROADCAST;

  // ── small DOM helpers ─────────────────────────────────────────────────────
  function h(tag, attrs) {
    const el = document.createElement(tag);
    Object.keys(attrs || {}).forEach((k) => {
      const v = attrs[k];
      if (v === undefined || v === null) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) kid.forEach((k) => add(el, k));
    else el.appendChild(typeof kid === 'object' ? kid : document.createTextNode(String(kid)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function busy(text) {
    $('busy').hidden = !text;
    $('busyText').textContent = text || '';
  }
  let sheetResolve = null;
  function openSheet(content) {
    clear($('sheet')).appendChild(content);
    $('sheetWrap').hidden = false;
    $('sheet').scrollTop = 0;
  }
  function closeSheet(result) {
    $('sheetWrap').hidden = true;
    clear($('sheet'));
    if (sheetResolve) { const r = sheetResolve; sheetResolve = null; r(result === undefined ? -1 : result); }
  }
  $('sheetWrap').addEventListener('click', (e) => { if (e.target === $('sheetWrap')) closeSheet(); });
  // A question with buttons; resolves to the index of the button pressed (-1 if dismissed).
  function ask(title, body, buttons) {
    if (sheetResolve) closeSheet();
    return new Promise((resolve) => {
      const box = h('div', {}, h('h2', { text: title }),
        typeof body === 'string' ? h('pre', { text: body }) : body,
        (buttons || [{ label: 'OK', cls: 'primary' }]).map((b, i) =>
          h('button', { class: 'wide ' + (b.cls || ''), text: b.label, onclick: () => closeSheet(i) })));
      openSheet(box);
      sheetResolve = resolve;
    });
  }
  const tell = (title, text) => ask(title, text, [{ label: 'OK', cls: 'primary' }]);

  function ago(secs) {
    if (!secs) return 'never';
    const d = Math.max(0, Math.floor(Date.now() / 1000) - secs);
    if (d < 60) return 'now';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }
  const pad2 = (n) => String(n).padStart(2, '0');
  function clock(ms) {
    const d = new Date(ms), today = new Date();
    const time = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    return d.toDateString() === today.toDateString() ? time : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + time;
  }
  function miles(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function batteryText(m) {
    if (!m || m.battery_level === undefined) return '';
    const volts = m.voltage ? ' (' + m.voltage.toFixed(2) + ' V)' : '';
    return (m.battery_level > 100 ? 'Plugged in' : m.battery_level + '%') + volts;
  }
  const same = (type, a, b) => JSON.stringify(PB.toJSON(type, a || {})) === JSON.stringify(PB.toJSON(type, b || {}));
  const connected = () => Radio.state === 'connected';
  const isDemo = () => !!(Radio.transport && Radio.transport.kind === 'demo');

  // ── tabs ──────────────────────────────────────────────────────────────────
  let currentTab = 'radio';
  function showTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + name));
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'messages') { openConversation(convKey); }
    if (name === 'nodes') renderNodes();
    if (name === 'map') showMap();
    if (name === 'settings') renderSettings();
  }
  document.querySelectorAll('#nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  // ── Radio tab ─────────────────────────────────────────────────────────────
  function browserHelp() {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return h('div', { class: 'card warn' },
      h('h2', { text: 'This browser can’t use Bluetooth radios' }),
      ios
        ? [h('p', { text: 'On iPhone and iPad, Safari and Chrome do not allow web pages to use Bluetooth. Install the free “Bluefy – Web BLE Browser” app from the App Store, then open this same page address in Bluefy.' }),
          h('p', { class: 'muted small', text: 'Page address: ' + location.href.split('?')[0] })]
        : h('p', { text: 'Open this page in Chrome on Android, or in Chrome or Edge on a PC. Firefox and Samsung Internet do not support Web Bluetooth. The page must be loaded over https.' }),
      h('p', { class: 'muted small', text: 'You can still look around with the demo radio below.' }));
  }

  function renderRadio() {
    const tab = clear($('tab-radio'));
    const badge = $('linkBadge');
    const me = Radio.me();
    const user = (me && me.user) || {};
    badge.className = 'badge ' + (connected() ? 'on' : Radio.state === 'disconnected' ? 'off' : 'busy-b');
    badge.textContent = connected() ? (user.short_name || 'Connected') + (isDemo() ? ' (demo)' : '')
      : Radio.state === 'disconnected' ? 'Not connected'
        : Radio.state === 'rebooting' ? 'Reconnecting…' : 'Connecting…';

    const banner = $('banner');
    const unset = connected() && ['UNSET', undefined].includes((Radio.config.lora || {}).region);
    if (Radio.state === 'rebooting') { banner.hidden = false; banner.textContent = Radio.statusText; }
    else if (unset) { banner.hidden = false; banner.textContent = 'This radio has no LoRa region set, so it cannot transmit. Set one under Settings › LoRa, or restore a settings backup.'; }
    else banner.hidden = true;

    if (Radio.state === 'disconnected') {
      if (!BleTransport.supported()) tab.appendChild(browserHelp());
      tab.appendChild(h('div', { class: 'card' },
        h('h2', { text: 'Connect to a radio' }),
        h('p', { class: 'muted', text: 'Turn the radio on and keep it close. If the phone asks for a pairing PIN, it is the 6-digit number on the radio’s screen (123456 on radios without a screen, unless you changed it).' }),
        Radio.statusText ? h('p', { class: 'hint bad', text: Radio.statusText }) : null,
        h('button', { class: 'primary wide', text: 'Connect by Bluetooth', disabled: !BleTransport.supported(), onclick: connectBle }),
        h('button', { class: 'wide', text: 'Try the demo radio', onclick: connectDemo }),
        h('p', { class: 'muted small', style: 'margin-top:12px', text: 'Only one app can hold a radio’s Bluetooth link at a time: close the Meshtastic app (or the PC program’s Bluetooth connection) first.' })));
      return;
    }
    if (!connected()) {
      tab.appendChild(h('div', { class: 'card' },
        h('h2', { text: Radio.state === 'rebooting' ? 'Reconnecting' : 'Connecting' }),
        h('div', { class: 'spinner' }),
        h('p', { text: Radio.statusText || 'Working…' }),
        h('p', { class: 'muted small', text: 'Bluetooth can take a minute, and reading a full node list takes longer. Be patient.' }),
        h('button', { class: 'wide', text: 'Cancel', onclick: () => Radio.disconnect() })));
      return;
    }
    const lora = Radio.config.lora || {};
    const meta = Radio.metadata || {};
    const pos = Radio.position(me);
    const rows = [
      ['Name', (user.long_name || '?') + ' (' + (user.short_name || '?') + ')'],
      ['Node ID', Radio.nodeId(Radio.myNum)],
      ['Hardware', String(user.hw_model || meta.hw_model || '?')],
      ['Firmware', meta.firmware_version || '?'],
      ['Role', String((Radio.config.device || {}).role || 'CLIENT')],
      ['Region', String(lora.region || 'UNSET')],
      ['Modem', lora.use_preset ? String(lora.modem_preset || 'LONG_FAST') : 'Custom'],
      ['Battery', batteryText(me && me.device_metrics) || 'not reported yet'],
      ['Position', pos ? pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5) : 'none'],
      ['Nodes known', String(Radio.nodes.size)],
      ['Link', Radio.transport.kind + (Radio.transport.name ? ' – ' + Radio.transport.name : '')],
    ];
    tab.appendChild(h('div', { class: 'card' },
      h('h2', { text: 'Connected' }),
      h('dl', { class: 'kv' }, rows.map((r) => [h('dt', { text: r[0] }), h('dd', { text: r[1] })])),
      h('button', { class: 'wide', text: 'Disconnect', onclick: () => Radio.disconnect() })));
    if (isDemo()) {
      tab.appendChild(h('div', { class: 'card warn' }, h('p', { style: 'margin:0', text: 'This is the built-in demo radio. Nothing here is real and nothing is transmitted.' })));
    }
  }

  async function connectBle() {
    const t = new BleTransport();
    try { await t.pick(); } catch (e) {
      if (e && e.name === 'NotFoundError') return;         // chooser closed
      tell('Bluetooth', Radio.describeError(e));
      return;
    }
    try { await Radio.connect(t); } catch (e) { tell('Could not connect', e.message); }
  }
  async function connectDemo() {
    try { await Radio.connect(new DemoTransport()); } catch (e) { tell('Demo', e.message); }
  }

  // ── Messages ──────────────────────────────────────────────────────────────
  let msgs = [];
  let unread = {};
  let convKey = 'c0';
  const msgStoreKey = () => 'meshmobile.msgs.' + Radio.nodeId(Radio.myNum);

  function loadMsgs() {
    try { msgs = JSON.parse(localStorage.getItem(msgStoreKey()) || '[]'); } catch (e) { msgs = []; }
    msgs.forEach((m) => { if (m.status === 'sending') m.status = 'unknown'; });
    unread = {};
  }
  function saveMsgs() {
    if (!Radio.myNum || isDemo()) return;
    if (msgs.length > 400) msgs = msgs.slice(-400);
    try { localStorage.setItem(msgStoreKey(), JSON.stringify(msgs)); } catch (e) { /* storage full */ }
  }
  function convTitle(key) {
    return key[0] === 'c' ? '# ' + Radio.channelName(+key.slice(1)) : Radio.nodeName(+key.slice(1));
  }
  function conversations() {
    const keys = [];
    Radio.channels.forEach((ch, i) => { if (ch && (ch.role || 'DISABLED') !== 'DISABLED') keys.push('c' + i); });
    if (!keys.length) keys.push('c0');
    msgs.forEach((m) => { if (!keys.includes(m.key)) keys.push(m.key); });
    if (!keys.includes(convKey)) keys.push(convKey);
    return keys;
  }
  function renderConvBar() {
    const bar = clear($('convBar'));
    conversations().forEach((key) => {
      bar.appendChild(h('button', { class: key === convKey ? 'active' : '', onclick: () => openConversation(key) },
        convTitle(key), unread[key] ? h('span', { class: 'n', text: unread[key] }) : null));
    });
    $('unreadDot').hidden = !Object.values(unread).some(Boolean);
  }
  function statusLabel(m) {
    switch (m.status) {
      case 'sending': return 'Sending…';
      case 'sent': return 'Sent';
      case 'delivered': return 'Delivered';
      case 'relayed': return 'Sent, not yet confirmed by the recipient';
      case 'noack': return 'No acknowledgement';
      case 'unknown': return '';
      default: return m.status ? 'Failed: ' + m.status : '';
    }
  }
  function renderMsgs() {
    const list = clear($('msgList'));
    const mine = msgs.filter((m) => m.key === convKey);
    if (!mine.length) list.appendChild(h('p', { class: 'empty', text: connected() ? 'No messages here yet.' : 'Connect to a radio to send and receive messages.' }));
    mine.forEach((m) => {
      const st = m.out ? statusLabel(m) : '';
      const failed = m.out && !['sending', 'sent', 'delivered', 'relayed', 'unknown'].includes(m.status);
      list.appendChild(h('div', { class: 'msg' + (m.out ? ' out' : '') },
        !m.out && convKey[0] === 'c' ? h('div', { class: 'who', text: Radio.nodeName(m.from) }) : null,
        m.text,
        h('div', { class: 'meta' + (failed ? ' fail' : ''), text: clock(m.time) + (st ? ' · ' + st : '') })));
    });
    list.scrollTop = list.scrollHeight;
    $('msgSend').disabled = !connected();
    $('msgInput').placeholder = 'Message ' + convTitle(convKey);
  }
  function openConversation(key) {
    convKey = key;
    unread[key] = 0;
    renderConvBar();
    renderMsgs();
  }
  function startDirect(num) {
    showTab('messages');
    openConversation('d' + num);
    $('msgInput').focus();
  }

  Radio.on('message', (m) => {
    const key = m.to === BROADCAST ? 'c' + m.channel : 'd' + m.from;
    msgs.push({ key, id: m.id, from: m.from, to: m.to, text: m.text, time: m.time, out: false });
    saveMsgs();
    if (currentTab === 'messages' && key === convKey) renderMsgs();
    else {
      unread[key] = (unread[key] || 0) + 1;
      toast(Radio.nodeName(m.from) + ': ' + m.text.slice(0, 80));
      if (navigator.vibrate) navigator.vibrate(120);
    }
    renderConvBar();
  });
  Radio.on('ack', (a) => {
    const m = msgs.find((x) => x.out && x.id === a.id);
    if (!m) return;
    if (!a.ok) m.status = a.reason;
    else if (m.to === BROADCAST) m.status = 'sent';
    else m.status = a.from === m.to ? 'delivered' : (m.status === 'delivered' ? 'delivered' : 'relayed');
    saveMsgs();
    if (currentTab === 'messages' && m.key === convKey) renderMsgs();
  });

  $('msgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $('msgInput').value.trim();
    if (!text || !connected()) return;
    const dm = convKey[0] === 'd';
    const to = dm ? +convKey.slice(1) : BROADCAST;
    const channel = dm ? 0 : +convKey.slice(1);
    try {
      const id = await Radio.sendText(text, to, channel);
      const m = { key: convKey, id, from: Radio.myNum, to, text, time: Date.now(), out: true, status: 'sending' };
      msgs.push(m);
      $('msgInput').value = '';
      $('msgInput').style.height = '';
      saveMsgs(); renderConvBar(); renderMsgs();
      setTimeout(() => {
        if (m.status === 'sending') { m.status = 'noack'; saveMsgs(); if (m.key === convKey) renderMsgs(); }
      }, 90000);
    } catch (err) { toast(err.message); }
  });
  $('msgInput').addEventListener('input', () => {
    const t = $('msgInput');
    t.style.height = 'auto';
    t.style.height = Math.min(110, t.scrollHeight + 2) + 'px';
  });
  $('msgInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); $('msgForm').requestSubmit(); }
  });

  // ── Nodes ─────────────────────────────────────────────────────────────────
  function nodeRows() {
    const myPos = Radio.position(Radio.me());
    return Array.from(Radio.nodes.values()).map((n) => {
      const pos = Radio.position(n);
      const user = n.user || {};
      return { n, num: n.num >>> 0, pos, user,
        long: user.long_name || Radio.nodeId(n.num), short: user.short_name || '?',
        dist: myPos && pos && n.num !== Radio.myNum ? miles(myPos, pos) : null };
    });
  }
  function renderNodes() {
    if (currentTab !== 'nodes') return;
    const list = clear($('nodeList'));
    const q = $('nodeSearch').value.trim().toLowerCase();
    const sort = $('nodeSort').value;
    let rows = nodeRows();
    const total = rows.length;
    if (q) rows = rows.filter((r) => (r.long + ' ' + r.short + ' ' + Radio.nodeId(r.num) + ' ' + (r.user.hw_model || '')).toLowerCase().includes(q));
    const big = (v) => (v === null || v === undefined ? Infinity : v);
    rows.sort((a, b) => {
      if (a.num === Radio.myNum) return -1;
      if (b.num === Radio.myNum) return 1;
      switch (sort) {
        case 'name': return a.long.localeCompare(b.long);
        case 'distance': return big(a.dist) - big(b.dist);
        case 'snr': return (b.n.snr === undefined ? -999 : b.n.snr) - (a.n.snr === undefined ? -999 : a.n.snr);
        case 'hops': return big(a.n.hops_away) - big(b.n.hops_away);
        default: return (b.n.last_heard || 0) - (a.n.last_heard || 0);
      }
    });
    $('nodeCount').textContent = connected()
      ? (q ? rows.length + ' of ' + total : total) + ' nodes in the radio’s list'
      : 'Connect to a radio to see its node list.';
    rows.forEach((r) => {
      const mine = r.num === Radio.myNum;
      const sub = [String(r.user.role || ''), String(r.user.hw_model || '')].filter(Boolean).join(' · ') || Radio.nodeId(r.num);
      list.appendChild(h('button', { class: 'node' + (mine ? ' me' : ''), onclick: () => nodeSheet(r.num) },
        h('span', { class: 'chip', text: r.short }),
        h('span', { class: 'mid' }, h('div', { class: 'name', text: r.long }), h('div', { class: 'sub', text: sub })),
        h('span', { class: 'right' },
          h('b', { text: mine ? 'This radio' : ago(r.n.last_heard) }),
          mine ? batteryText(r.n.device_metrics).split(' (')[0]
            : [r.dist !== null ? r.dist.toFixed(1) + ' mi' : null,
              r.n.snr !== undefined && r.n.snr !== 0 ? r.n.snr.toFixed(1) + ' dB' : null,
              r.n.hops_away !== undefined ? r.n.hops_away + ' hop' + (r.n.hops_away === 1 ? '' : 's') : null]
              .filter(Boolean).slice(0, 2).join(' · '))));
    });
  }
  let nodesTimer = 0;
  function nodesChanged() {
    if (nodesTimer) return;
    nodesTimer = setTimeout(() => {
      nodesTimer = 0;
      renderNodes();
      if (currentTab === 'map') updateMarkers(false);
      if (currentTab === 'radio') renderRadio();
    }, 400);
  }
  $('nodeSearch').addEventListener('input', renderNodes);
  $('nodeSort').addEventListener('change', renderNodes);

  function nodeSheet(num) {
    const n = Radio.nodes.get(num);
    if (!n) return;
    const user = n.user || {}, pos = Radio.position(n), myPos = Radio.position(Radio.me());
    const mine = num === Radio.myNum;
    const heard = n.last_heard ? new Date(n.last_heard * 1000) : null;
    const rows = [
      ['Short name', user.short_name || '?'],
      ['Node ID', Radio.nodeId(num)],
      ['Hardware', String(user.hw_model || '?')],
      ['Role', String(user.role || 'CLIENT')],
      ['Last heard', mine ? 'this radio' : heard ? heard.toLocaleDateString() + ' ' + pad2(heard.getHours()) + ':' + pad2(heard.getMinutes()) + ' (' + ago(n.last_heard) + ')' : 'never'],
      ['Signal (SNR)', n.snr !== undefined && !mine ? n.snr.toFixed(2) + ' dB' : '—'],
      ['Hops away', n.hops_away !== undefined && !mine ? String(n.hops_away) : '—'],
      ['Channel', Radio.channelName(n.heard_channel !== undefined ? n.heard_channel : (n.channel || 0))],
      ['Battery', batteryText(n.device_metrics) || '—'],
      ['Position', pos ? pos.lat.toFixed(5) + ', ' + pos.lon.toFixed(5) + (pos.alt ? ' (' + pos.alt + ' m)' : '') : 'none'],
      ['Distance', pos && myPos && !mine ? miles(myPos, pos).toFixed(1) + ' mi' : '—'],
      ['Heard via', n.via_mqtt ? 'MQTT (internet)' : 'radio'],
    ];
    openSheet(h('div', {},
      h('h2', { text: user.long_name || Radio.nodeId(num) }),
      h('dl', { class: 'kv' }, rows.map((r) => [h('dt', { text: r[0] }), h('dd', { text: r[1] })])),
      !mine && !user.is_unmessagable ? h('button', { class: 'primary wide', text: 'Send a direct message', onclick: () => { closeSheet(); startDirect(num); } }) : null,
      pos ? h('button', { class: 'wide', text: 'Show on map', onclick: () => { closeSheet(); showTab('map'); focusNode(num); } }) : null,
      h('button', { class: 'wide', text: 'Close', onclick: () => closeSheet() })));
  }

  // ── Map (Leaflet + Esri street tiles, same as the desktop program) ───────
  const LEAFLET = 'https://unpkg.com/leaflet@1.9.4/dist/';
  const TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  let map = null, markers = new Map(), leafletLoading = null, pendingFocus = null;

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletLoading) return leafletLoading;
    leafletLoading = new Promise((resolve, reject) => {
      document.head.appendChild(h('link', { rel: 'stylesheet', href: LEAFLET + 'leaflet.css' }));
      document.head.appendChild(h('script', { src: LEAFLET + 'leaflet.js', onload: resolve,
        onerror: () => { leafletLoading = null; reject(new Error('The map needs an internet connection.')); } }));
    });
    return leafletLoading;
  }
  async function showMap() {
    try { await loadLeaflet(); } catch (e) { $('mapNote').textContent = e.message; return; }
    if (!map) {
      map = L.map('map', { zoomControl: true }).setView([27.95, -82.5], 9);
      L.tileLayer(TILES, { maxZoom: 19, attribution: 'Tiles © Esri' }).addTo(map);
    }
    setTimeout(() => { map.invalidateSize(); updateMarkers(!pendingFocus); if (pendingFocus) focusNode(pendingFocus); }, 50);
  }
  function updateMarkers(fit) {
    if (!map) return;
    const seen = new Set(), points = [];
    Radio.nodes.forEach((n) => {
      const pos = Radio.position(n);
      if (!pos) return;
      const num = n.num >>> 0, mine = num === Radio.myNum;
      seen.add(num); points.push([pos.lat, pos.lon]);
      let m = markers.get(num);
      if (!m) {
        m = L.circleMarker([pos.lat, pos.lon], { radius: mine ? 10 : 8, weight: 2, color: '#0a1929',
          fillColor: mine ? '#ff9f1c' : '#2ec4b6', fillOpacity: 0.95 }).addTo(map);
        m.on('click', () => nodeSheet(num));
        markers.set(num, m);
      } else m.setLatLng([pos.lat, pos.lon]);
      const label = (n.user && n.user.short_name) || Radio.nodeId(num).slice(-4);
      if (m.labelText !== label) {
        m.unbindTooltip();
        m.bindTooltip(document.createTextNode(label).textContent, { permanent: true, direction: 'top', offset: [0, -8], className: 'node-label' });
        m.labelText = label;
      }
    });
    markers.forEach((m, num) => { if (!seen.has(num)) { m.remove(); markers.delete(num); } });
    $('mapNote').textContent = connected()
      ? points.length + ' of ' + Radio.nodes.size + ' nodes have reported a position. Orange is this radio.'
      : 'Connect to a radio to see its nodes on the map.';
    if (fit && points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
  }
  function focusNode(num) {
    pendingFocus = num;
    const m = markers.get(num);
    if (!map || !m) return;
    pendingFocus = null;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 13));
  }

  // ── Settings: form pieces ─────────────────────────────────────────────────
  function field(label, control, hint) {
    return [h('label', { class: 'field' }, h('span', { text: label }), control), hint ? h('p', { class: 'hint', text: hint }) : null];
  }
  function check(label, checked) {
    const input = h('input', { type: 'checkbox', checked: !!checked });
    return { input, el: h('label', { class: 'check' }, input, h('span', { text: label })) };
  }
  function select(options, value) {
    const el = h('select', {});
    setOptions(el, options, value);
    return el;
  }
  function setOptions(el, options, value) {
    const want = value === undefined ? el.value : String(value);
    clear(el);
    const list = options.map((o) => (Array.isArray(o) ? o : [o, o]));
    if (want !== '' && !list.some((o) => String(o[0]) === want)) list.push([want, want + ' (current)']);
    list.forEach((o) => el.appendChild(h('option', { value: String(o[0]), text: String(o[1]) })));
    el.value = want;
  }
  function section(title, body, open) {
    return h('details', { class: 'sec', open: !!open }, h('summary', { text: title }), h('div', { class: 'body' }, body));
  }
  const openSections = new Set();

  // Confirm, write the steps in one transaction, and let the radio restart.
  async function saveSteps(title, steps) {
    if (!steps.length) { toast('Nothing was changed.'); return false; }
    const go = await ask(title, 'This writes ' + steps.map((s) => s.label).join(', ') +
      ' to the radio. The radio may restart, and the app reconnects by itself.', [{ label: 'Save to radio', cls: 'primary' }, { label: 'Cancel' }]);
    if (go !== 0) return false;
    busy('Saving…');
    try {
      await Radio.saveSettings(steps, (s) => busy('Saving ' + s + '…'));
      Radio.expectReboot();
      toast('Saved to the radio.');
      return true;
    } catch (e) {
      busy(null);
      await tell('Could not save', e.message);
      return false;
    } finally { busy(null); }
  }
  const configStep = (name, value) => ({ label: name + ' settings', admin: { set_config: { [name]: value } },
    apply: () => { Radio.config[name] = value; } });

  // ── Settings: Device ──────────────────────────────────────────────────────
  function deviceSection() {
    const me = Radio.me() || {}, user = me.user || {};
    const dev = Radio.config.device || {}, bt = Radio.config.bluetooth || {}, power = Radio.config.power || {};
    const longName = h('input', { type: 'text', value: user.long_name || '', maxLength: 39 });
    const shortName = h('input', { type: 'text', value: user.short_name || '', maxLength: 4 });
    const role = select(PB.enumNames('Config.DeviceConfig.Role'), dev.role || 'CLIENT');
    const pin = h('input', { type: 'number', inputMode: 'numeric', value: bt.fixed_pin || 0, min: 0, max: 999999 });
    const wait = h('input', { type: 'number', inputMode: 'numeric', value: power.wait_bluetooth_secs || 0, min: 0, max: 86400 });
    const save = h('button', { class: 'primary wide', text: 'Save device settings', onclick: async () => {
      const ln = longName.value.trim(), sn = shortName.value.trim();
      if (!ln || !sn) { tell('Device', 'Long name and short name cannot be empty.'); return; }
      if (new TextEncoder().encode(ln).length > 39) { tell('Device', 'Long name is too long (39 bytes at most).'); return; }
      const pinNum = parseInt(pin.value, 10) || 0;
      if (pinNum && (pinNum < 100000 || pinNum > 999999)) { tell('Device', 'The Bluetooth PIN must be 6 digits (100000-999999).'); return; }
      const steps = [];
      if (ln !== (user.long_name || '') || sn !== (user.short_name || '')) {
        const owner = { long_name: ln, short_name: sn, is_licensed: !!user.is_licensed };
        if (user.is_unmessagable !== undefined) owner.is_unmessagable = user.is_unmessagable;
        steps.push({ label: 'owner name', admin: { set_owner: owner },
          apply: () => { me.user = Object.assign({}, user, { long_name: ln, short_name: sn }); } });
      }
      const nbt = Object.assign({}, bt, { fixed_pin: pinNum });
      if (!same('Config.BluetoothConfig', bt, nbt)) steps.push(configStep('bluetooth', nbt));
      const ndev = Object.assign({}, dev, { role: role.value });
      if (!same('Config.DeviceConfig', dev, ndev)) steps.push(configStep('device', ndev));
      const npow = Object.assign({}, power, { wait_bluetooth_secs: parseInt(wait.value, 10) || 0 });
      if (!same('Config.PowerConfig', power, npow)) steps.push(configStep('power', npow));
      await saveSteps('Save device settings?', steps);
    } });
    return section('Device', [
      field('Long name', longName),
      field('Short name (up to 4 characters)', shortName),
      field('Role', role, 'CLIENT suits almost every radio. ROUTER and REPEATER are for well-placed fixed stations only.'),
      field('Bluetooth pairing PIN', pin, 'Used when the radio’s pairing mode is Fixed PIN. Changing it means pairing this phone again.'),
      field('Keep Bluetooth awake (seconds)', wait, 'How long the radio waits for Bluetooth before sleeping. 0 uses the firmware default.'),
      save], openSections.has('Device'));
  }

  // ── Settings: LoRa ────────────────────────────────────────────────────────
  function loraSection() {
    const cur = Radio.config.lora || {};
    const E = 'Config.LoRaConfig.';
    const region = select(PB.enumNames(E + 'RegionCode'), cur.region || 'UNSET');
    const usePreset = check('Use a modem preset', cur.use_preset);
    const preset = select(Object.keys(LoRa.PRESETS), cur.modem_preset || 'LONG_FAST');
    const bw = select([], cur.bandwidth || 250);
    const sf = select(LoRa.SF_CHOICES, cur.spread_factor || 11);
    const cr = select(LoRa.CR_CHOICES.map((c) => [c, '4/' + c]), cur.coding_rate || 5);
    const hops = h('input', { type: 'number', inputMode: 'numeric', min: 0, max: LoRa.HOP_MAX, value: cur.hop_limit === undefined ? 3 : cur.hop_limit });
    const power = h('input', { type: 'number', inputMode: 'numeric', min: 0, value: cur.tx_power || 0 });
    const slot = h('input', { type: 'number', inputMode: 'numeric', min: 0, value: cur.channel_num || 0 });
    const override = h('input', { type: 'text', inputMode: 'decimal', value: cur.override_frequency || 0 });
    const offset = h('input', { type: 'text', inputMode: 'decimal', value: cur.frequency_offset || 0 });
    const txEnabled = check('Transmit enabled', cur.tx_enabled);
    const duty = check('Override duty-cycle limit', cur.override_duty_cycle);
    const boosted = check('SX126x boosted receive gain', cur.sx126x_rx_boosted_gain);
    const fan = check('PA fan disabled', cur.pa_fan_disabled);
    const ignoreMqtt = check('Ignore packets that came through MQTT', cur.ignore_mqtt);
    const okMqtt = check('OK to send my packets to MQTT', cur.config_ok_to_mqtt);
    let fem = null;
    try { fem = select(PB.enumNames(E + 'FEM_LNA_Mode'), cur.fem_lna_mode || PB.enumNames(E + 'FEM_LNA_Mode')[0]); } catch (e) { fem = null; }

    const presetField = h('div', {}, field('Modem preset', preset));
    const manual = h('div', {}, field('Bandwidth', bw), field('Spread factor', sf), field('Coding rate', cr));
    const regionHint = h('p', { class: 'hint' }), powerHint = h('p', { class: 'hint' }), slotHint = h('p', { class: 'hint' });
    const problems = h('p', { class: 'hint bad' });

    function values() {
      return { region: region.value, use_preset: usePreset.input.checked, modem_preset: preset.value,
        bandwidth: bw.value, spread_factor: sf.value, coding_rate: cr.value, hop_limit: hops.value,
        tx_power: power.value, channel_num: slot.value, override_frequency: override.value, frequency_offset: offset.value };
    }
    function refresh() {
      const r = region.value, lim = LoRa.limits(r);
      setOptions(preset, lim ? LoRa.validPresets(r) : Object.keys(LoRa.PRESETS));
      if (!preset.value) preset.selectedIndex = 0;
      setOptions(bw, LoRa.validBwCodes(r).map((c) => [c, LoRa.bwKhz(c) + ' kHz']));
      if (!bw.value) bw.selectedIndex = 0;
      presetField.hidden = !usePreset.input.checked;
      manual.hidden = usePreset.input.checked;
      regionHint.textContent = lim ? lim[0] + '–' + lim[1] + ' MHz, up to ' + lim[2] + ' dBm' + (lim[3] < 100 ? ', ' + lim[3] + '% duty cycle' : '')
        : 'This app has no band table for ' + r + ', so the choices below are not narrowed to it.';
      power.max = LoRa.maxPower(r);
      powerHint.textContent = '0 uses the radio’s default. Limit for ' + r + ': ' + LoRa.maxPower(r) + ' dBm.';
      const s = values();
      let text = '0 picks the slot from the primary channel name.';
      try {
        const khz = LoRa.effectiveBwKhz(s), n = LoRa.slotCount(r, khz), k = parseInt(s.channel_num, 10);
        if (n) text += (n === 1 ? ' Only slot 1 fits' : ' Slots 1–' + n) + ' at ' + khz + ' kHz.';
        if (lim && k >= 1 && k <= n) text += ' Slot ' + k + ' is ' + LoRa.slotFreqMhz(r, khz, k).toFixed(3) + ' MHz.';
      } catch (e) { /* preset not valid yet */ }
      slotHint.textContent = text;
      problems.textContent = '';
    }
    [region, preset, bw, slot, usePreset.input].forEach((el) => el.addEventListener('change', refresh));
    slot.addEventListener('input', refresh);
    refresh();

    const save = h('button', { class: 'primary wide', text: 'Save LoRa settings', onclick: async () => {
      const s = values();
      const bad = LoRa.validate(s);
      if (bad.length) { problems.textContent = bad.join(' '); return; }
      const next = Object.assign({}, cur, {
        region: s.region, use_preset: s.use_preset, modem_preset: s.modem_preset,
        hop_limit: parseInt(s.hop_limit, 10), tx_power: parseInt(s.tx_power, 10), channel_num: parseInt(s.channel_num, 10),
        override_frequency: parseFloat(s.override_frequency) || 0, frequency_offset: parseFloat(s.frequency_offset) || 0,
        tx_enabled: txEnabled.input.checked, override_duty_cycle: duty.input.checked,
        sx126x_rx_boosted_gain: boosted.input.checked, pa_fan_disabled: fan.input.checked,
        ignore_mqtt: ignoreMqtt.input.checked, config_ok_to_mqtt: okMqtt.input.checked });
      if (fem) next.fem_lna_mode = fem.value;
      if (!s.use_preset) {           // in preset mode the stored bandwidth/SF/CR are left as they are
        next.bandwidth = parseInt(s.bandwidth, 10); next.spread_factor = parseInt(s.spread_factor, 10); next.coding_rate = parseInt(s.coding_rate, 10);
      }
      if (same('Config.LoRaConfig', cur, next)) { toast('Nothing was changed.'); return; }
      if (!next.tx_enabled) {
        const sure = await ask('Transmit is off', 'With transmit disabled the radio only listens. Save anyway?', [{ label: 'Save anyway', cls: 'primary' }, { label: 'Cancel' }]);
        if (sure !== 0) return;
      }
      await saveSteps('Save LoRa settings?', [configStep('lora', next)]);
    } });
    return section('LoRa', [
      h('p', { class: 'muted small', text: 'Every radio on your mesh must use the same region, preset and frequency slot. A wrong change here takes this radio off the mesh.' }),
      field('Region', region), regionHint,
      usePreset.el, presetField, manual,
      field('Hop limit (0–' + LoRa.HOP_MAX + ')', hops),
      field('Transmit power (dBm)', power), powerHint,
      txEnabled.el,
      field('Frequency slot', slot), slotHint,
      field('Override frequency (MHz, 0 = off)', override),
      field('Frequency offset (MHz)', offset),
      duty.el, boosted.el, fan.el, ignoreMqtt.el, okMqtt.el,
      fem ? field('Front-end LNA mode', fem) : null,
      problems, save], openSections.has('LoRa'));
  }

  // ── Settings: Channels ────────────────────────────────────────────────────
  function pskKind(psk) {
    const b = psk ? PB.asBytes(psk) : new Uint8Array();
    if (!b.length || (b.length === 1 && b[0] === 0)) return 'None';
    if (b.length === 1 && b[0] === 1) return 'Default';
    return 'Custom';
  }
  function channelsSection() {
    const rows = Radio.channels.map((ch, i) => {
      const role = (ch && ch.role) || 'DISABLED';
      if (role === 'DISABLED') return null;
      const s = ch.settings || {};
      return h('button', { class: 'chan', onclick: () => channelSheet(i, false) },
        h('span', { class: 'chip', text: String(i) }),
        h('span', { class: 'mid' }, h('div', { class: 'name', text: Radio.channelName(i) }),
          h('div', { class: 'sub muted small', text: role + ' · key: ' + pskKind(s.psk) + (s.uplink_enabled ? ' · uplink' : '') + (s.downlink_enabled ? ' · downlink' : '') })),
        h('span', { class: 'muted', text: '›' }));
    });
    const free = Radio.channels.findIndex((ch, i) => i > 0 && ((ch && ch.role) || 'DISABLED') === 'DISABLED');
    return section('Channels', [
      rows,
      h('button', { class: 'wide', text: 'Add a channel', disabled: free < 0, onclick: () => channelSheet(free, true) }),
      h('p', { class: 'hint', style: 'margin-top:10px', text: 'Channel changes are saved straight away and do not restart the radio.' }),
    ], openSections.has('Channels'));
  }
  function channelSheet(index, isNew) {
    const ch = Radio.channels[index] || {}, s = ch.settings || {}, mod = s.module_settings || {};
    const kind = isNew ? 'Random' : pskKind(s.psk);
    const name = h('input', { type: 'text', value: s.name || '', maxLength: 11 });
    const keyMode = select(['None', 'Default', ['Random', 'Random (new 256-bit key)'], 'Custom'], kind);
    const custom = h('input', { type: 'text', autocapitalize: 'off', autocomplete: 'off', spellcheck: false,
      value: kind === 'Custom' ? PB.bytesToB64(PB.asBytes(s.psk)) : '' });
    const customField = h('div', {}, field('Key (base64)', custom, 'Share this key with the other radios on the channel. 16 or 32 bytes.'));
    const uplink = check('MQTT uplink', s.uplink_enabled), downlink = check('MQTT downlink', s.downlink_enabled);
    const precision = h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 32, value: mod.position_precision || 0 });
    const muted = check('Muted', mod.is_muted);
    const sync = () => { customField.hidden = keyMode.value !== 'Custom'; };
    keyMode.addEventListener('change', sync); sync();

    async function save() {
      let psk;
      try {
        if (keyMode.value === 'None') psk = Uint8Array.of(0);
        else if (keyMode.value === 'Default') psk = Uint8Array.of(1);
        else if (keyMode.value === 'Random') psk = crypto.getRandomValues(new Uint8Array(32));
        else {
          psk = PB.b64ToBytes(custom.value.trim());
          if (![1, 16, 32].includes(psk.length)) throw new Error('length');
        }
      } catch (e) { toast('The key must be valid base64 of 16 or 32 bytes.'); return; }
      if (new TextEncoder().encode(name.value.trim()).length > 11) { toast('Channel name is too long (11 bytes at most).'); return; }
      const p = parseInt(precision.value, 10) || 0;
      if (p < 0 || p > 32) { toast('Position precision must be 0-32.'); return; }
      const next = Object.assign({}, ch, { index,
        role: isNew ? 'SECONDARY' : (ch.role || 'SECONDARY'),
        settings: Object.assign({}, s, { name: name.value.trim(), psk, uplink_enabled: uplink.input.checked,
          downlink_enabled: downlink.input.checked,
          module_settings: Object.assign({}, mod, { position_precision: p, is_muted: muted.input.checked }) }) });
      closeSheet();
      busy('Saving channel…');
      try { await Radio.writeChannel(next); toast('Channel saved.'); } catch (e) { busy(null); await tell('Could not save the channel', e.message); }
      busy(null);
    }
    async function del() {
      closeSheet();
      const sure = await ask('Delete this channel?', 'Channel ' + index + ' (' + Radio.channelName(index) + ') will be removed and the channels after it move up one slot.',
        [{ label: 'Delete channel', cls: 'danger' }, { label: 'Cancel' }]);
      if (sure !== 0) return;
      busy('Deleting channel…');
      try { await Radio.deleteChannel(index); toast('Channel deleted.'); } catch (e) { busy(null); await tell('Could not delete the channel', e.message); }
      busy(null);
    }
    openSheet(h('div', {},
      h('h2', { text: isNew ? 'New channel (slot ' + index + ')' : 'Channel ' + index + ' – ' + (ch.role || '') }),
      field('Name', name, index === 0 ? 'Leave empty to use the preset’s standard name.' : null),
      field('Encryption key', keyMode, 'Default is the public Meshtastic key: anyone can read it.'),
      customField,
      uplink.el, downlink.el,
      field('Position precision (bits, 0 = don’t share position)', precision, '32 shares the exact position; 13 is roughly a 2-mile area.'),
      muted.el,
      h('button', { class: 'primary wide', text: 'Save channel', onclick: save }),
      !isNew && ch.role === 'SECONDARY' ? h('button', { class: 'danger wide', text: 'Delete channel', onclick: del }) : null,
      h('button', { class: 'wide', text: 'Cancel', onclick: () => closeSheet() })));
  }

  // ── Settings: Network ─────────────────────────────────────────────────────
  function networkSection() {
    const cur = Radio.config.network || {}, v4 = cur.ipv4_config || {}, meta = Radio.metadata || {};
    const hasNet = meta.hasWifi || meta.hasEthernet;
    const wifi = check('WiFi enabled', cur.wifi_enabled);
    const ssid = h('input', { type: 'text', value: cur.wifi_ssid || '', maxLength: 32, autocapitalize: 'off', autocomplete: 'off' });
    const psk = h('input', { type: 'password', value: cur.wifi_psk || '', maxLength: 64, autocomplete: 'off' });
    const show = check('Show password', false);
    show.input.addEventListener('change', () => { psk.type = show.input.checked ? 'text' : 'password'; });
    const eth = check('Ethernet enabled', cur.eth_enabled);
    const mode = select(PB.enumNames('Config.NetworkConfig.AddressMode'), cur.address_mode || 'DHCP');
    const ip = h('input', { type: 'text', inputMode: 'decimal', value: Net.intToIp(v4.ip) });
    const subnet = h('input', { type: 'text', inputMode: 'decimal', value: Net.intToIp(v4.subnet) });
    const gateway = h('input', { type: 'text', inputMode: 'decimal', value: Net.intToIp(v4.gateway) });
    const dns = h('input', { type: 'text', inputMode: 'decimal', value: Net.intToIp(v4.dns) });
    const fixed = h('div', {}, field('IP address', ip), field('Subnet mask', subnet, 'For example 255.255.255.0 or /24.'), field('Gateway', gateway), field('DNS', dns));
    const sync = () => { fixed.hidden = mode.value !== 'STATIC'; };
    mode.addEventListener('change', sync); sync();
    const save = h('button', { class: 'primary wide', text: 'Save network settings', onclick: async () => {
      let values;
      try { values = Net.validateNetwork(mode.value, ip.value, subnet.value, gateway.value, dns.value); } catch (e) { tell('Network', e.message); return; }
      if (wifi.input.checked && !ssid.value.trim()) { tell('Network', 'Enter the WiFi network name (SSID).'); return; }
      const next = Object.assign({}, cur, { wifi_enabled: wifi.input.checked, wifi_ssid: ssid.value.trim(), wifi_psk: psk.value,
        eth_enabled: eth.input.checked, address_mode: mode.value });
      if (mode.value === 'STATIC') next.ipv4_config = Object.assign({}, v4, values);   // DHCP: stored static values are left alone
      if (same('Config.NetworkConfig', cur, next)) { toast('Nothing was changed.'); return; }
      await saveSteps('Save network settings?', [configStep('network', next)]);
    } });
    return section('Network', [
      Radio.metadata && !hasNet ? h('p', { class: 'hint bad', text: 'This radio reports no WiFi or Ethernet hardware, so these settings have no effect on it.' }) : null,
      meta.hasWifi ? h('p', { class: 'hint', text: 'On ESP32 radios, turning WiFi on turns Bluetooth off: after saving, this phone can only reach the radio again once WiFi is turned off (from the PC program over USB, or the radio’s own menu).' }) : null,
      wifi.el, field('WiFi network name (SSID)', ssid), field('WiFi password', psk), show.el,
      eth.el, field('Address mode', mode), fixed, save], openSections.has('Network'));
  }

  // ── Settings: MQTT ────────────────────────────────────────────────────────
  function mqttSection() {
    const cur = Radio.moduleConfig.mqtt || {}, map = cur.map_report_settings || {}, meta = Radio.metadata || {};
    const enabled = check('MQTT enabled', cur.enabled);
    const address = h('input', { type: 'text', value: cur.address || '', autocapitalize: 'off', autocomplete: 'off' });
    const username = h('input', { type: 'text', value: cur.username || '', autocapitalize: 'off', autocomplete: 'off' });
    const password = h('input', { type: 'password', value: cur.password || '', autocomplete: 'off' });
    const root = h('input', { type: 'text', value: cur.root || '', autocapitalize: 'off', autocomplete: 'off' });
    const enc = check('Encryption enabled', cur.encryption_enabled);
    const json = check('JSON output enabled', cur.json_enabled);
    const tls = check('TLS enabled', cur.tls_enabled);
    const proxy = check('Proxy to client (use the phone’s internet)', cur.proxy_to_client_enabled);
    const mapOn = check('Map reporting enabled', cur.map_reporting_enabled);
    const interval = h('input', { type: 'number', inputMode: 'numeric', min: 0, value: map.publish_interval_secs || 0 });
    const precision = h('input', { type: 'number', inputMode: 'numeric', min: 0, max: 32, value: map.position_precision || 0 });
    const shareLoc = check('Report my location to the map', map.should_report_location);
    const save = h('button', { class: 'primary wide', text: 'Save MQTT settings', onclick: async () => {
      const next = Object.assign({}, cur, { enabled: enabled.input.checked, address: address.value.trim(), username: username.value,
        password: password.value, root: root.value.trim(), encryption_enabled: enc.input.checked, json_enabled: json.input.checked,
        tls_enabled: tls.input.checked, proxy_to_client_enabled: proxy.input.checked, map_reporting_enabled: mapOn.input.checked,
        map_report_settings: Object.assign({}, map, { publish_interval_secs: parseInt(interval.value, 10) || 0,
          position_precision: parseInt(precision.value, 10) || 0, should_report_location: shareLoc.input.checked }) });
      if (same('ModuleConfig.MQTTConfig', cur, next)) { toast('Nothing was changed.'); return; }
      if (next.enabled && Radio.metadata && !meta.hasWifi && !meta.hasEthernet && !next.proxy_to_client_enabled) {
        const pick = await ask('This radio has no WiFi or Ethernet',
          'The firmware silently turns MQTT back off on a radio with no network hardware unless “Proxy to client” is on.',
          [{ label: 'Turn the proxy on and save', cls: 'primary' }, { label: 'Save as it is' }, { label: 'Cancel' }]);
        if (pick === 0) next.proxy_to_client_enabled = true;
        else if (pick !== 1) return;
      }
      await saveSteps('Save MQTT settings?', [{ label: 'MQTT module', admin: { set_module_config: { mqtt: next } },
        apply: () => { Radio.moduleConfig.mqtt = next; } }]);
    } });
    return section('MQTT', [
      h('p', { class: 'hint', text: 'This app does not relay MQTT traffic itself. “Proxy to client” only carries traffic while the official Meshtastic app or the PC program is the connected client.' }),
      enabled.el, field('Server address', address), field('Username', username), field('Password', password),
      field('Root topic', root), enc.el, json.el, tls.el, proxy.el, mapOn.el,
      field('Map publish interval (seconds)', interval), field('Map position precision (bits)', precision), shareLoc.el, save],
    openSections.has('MQTT'));
  }

  // ── Settings: Backup and restore ──────────────────────────────────────────
  async function doRestore(data) {
    try { Backup.check(data); } catch (e) { tell('Restore', e.message); return; }
    if (!connected()) { tell('Restore', 'Connect to the radio you want to restore first.'); return; }
    let identity = true;
    const other = (data.device || {}).node_id && data.device.node_id !== Radio.nodeId(Radio.myNum);
    const warn = Backup.isUnconfigured(data) ? '\n\nThis backup was made of a radio with no LoRa region set.' : '';
    if (other) {
      const pick = await ask('This backup is from a different radio',
        Backup.describe(data) + warn + '\n\nConnected radio: ' + Radio.nodeId(Radio.myNum) +
        '\n\nKeeping this radio’s own key pair is right when copying settings to a second radio. Taking the backup’s keys is only for replacing a lost or reset radio.',
        [{ label: 'Restore, keep this radio’s keys', cls: 'primary' }, { label: 'Restore with the backup’s keys' }, { label: 'Cancel' }]);
      if (pick !== 0 && pick !== 1) return;
      identity = pick === 1;
    } else {
      const go = await ask('Restore these settings?', Backup.describe(data) + warn + '\n\nEvery setting on the radio is replaced and the radio restarts.',
        [{ label: 'Restore to radio', cls: 'primary' }, { label: 'Cancel' }]);
      if (go !== 0) return;
    }
    busy('Restoring…');
    try {
      const result = await Backup.restore(data, identity, (s) => busy('Restoring ' + s + '…'));
      busy(null);
      await tell('Settings restored', 'Written: ' + result.written.join(', ') +
        (result.skipped.length ? '\n\nSkipped: ' + result.skipped.join('; ') : '') + '\n\nThe radio is restarting; the app reconnects by itself.');
    } catch (e) { busy(null); await tell('Restore failed', e.message + '\n\nSome settings may have been written. Check the radio, then try again.'); }
  }
  function backupSection() {
    const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      let data;
      try { data = JSON.parse(await f.text()); } catch (e) { tell('Restore', f.name + ' isn’t a readable backup file.'); return; }
      doRestore(data);
    } });
    const list = Backup.stored();
    return section('Settings backup and restore', [
      h('p', { class: 'hint', text: 'A backup holds every setting, including the radio’s private key, channel keys and WiFi/MQTT passwords. Keep the files private. Backups work with the PC program too.' }),
      h('button', { class: 'primary wide', text: 'Back up this radio now', disabled: !connected(), onclick: async () => {
        busy('Reading settings…');
        try {
          const data = await Backup.capture('manual', true);
          if (!isDemo()) Backup.store(data);
          busy(null);
          await Backup.exportFile(data);
          toast('Backup made.');
          renderSettings();
        } catch (e) { busy(null); tell('Backup failed', e.message); }
      } }),
      h('button', { class: 'wide', text: 'Restore from a backup file…', disabled: !connected(), onclick: () => fileInput.click() }),
      fileInput,
      h('h3', { text: 'Kept on this phone' }),
      list.length ? null : h('p', { class: 'muted small', text: 'None yet. One is kept automatically each time a radio’s settings have changed since the last connection.' }),
      list.map((b, i) => h('div', { class: 'bk' },
        h('div', { text: ((b.owner || {}).long_name || '?') + '  ' + ((b.device || {}).node_id || '') }),
        h('div', { class: 'muted small', text: String(b.created || '').replace('T', ' ') + ' · ' + (b.reason || '') + ' · firmware ' + ((b.device || {}).firmware || '?') }),
        h('div', { class: 'row' },
          h('button', { text: 'Restore', disabled: !connected(), onclick: () => doRestore(b) }),
          h('button', { text: 'Save file', onclick: () => Backup.exportFile(b) }),
          h('button', { class: 'danger', text: 'Delete', onclick: async () => {
            const sure = await ask('Delete this backup?', Backup.describe(b), [{ label: 'Delete', cls: 'danger' }, { label: 'Cancel' }]);
            if (sure === 0) { Backup.remove(i); renderSettings(); }
          } })))),
    ], openSections.has('Settings backup and restore'));
  }

  // ── Settings: the rest ────────────────────────────────────────────────────
  function radioSection() {
    return section('Restart radio', [
      h('button', { class: 'wide', text: 'Restart the radio', onclick: async () => {
        const go = await ask('Restart the radio?', 'The radio restarts in a few seconds and the app reconnects by itself.', [{ label: 'Restart', cls: 'primary' }, { label: 'Cancel' }]);
        if (go !== 0) return;
        try { await Radio.reboot(5); toast('Restarting…'); } catch (e) { tell('Restart', e.message); }
      } })], openSections.has('Restart radio'));
  }
  let logBox = null;
  function logText() {
    return Radio.log.slice(-200).map((l) => { const d = new Date(l.t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '  ' + l.text; }).join('\n') || 'Nothing logged yet.';
  }
  function logSection() {
    logBox = h('div', { class: 'log', text: logText() });
    return section('Log', [logBox], openSections.has('Log'));
  }
  function aboutSection() {
    return section('About', [
      h('p', { text: 'Meshtastic Mobile ' + APP_VERSION }),
      h('p', { class: 'muted small', text: 'A phone companion to the Meshtastic GUI PC program. Radio message definitions from the meshtastic library ' + PB.version + '. Firmware updates and full-flash backups need the PC program.' }),
      h('p', { class: 'muted small', text: 'Android: open in Chrome, then menu › Add to Home screen. iPhone: open in the Bluefy browser (Safari cannot use Bluetooth radios).' }),
      h('p', { class: 'muted small', text: 'Messages and settings backups are stored only on this phone. Map tiles © Esri. Meshtastic® is a registered trademark of Meshtastic LLC; this app is independent and not affiliated with or endorsed by the Meshtastic project.' }),
      h('a', { class: 'btn wide', href: GUIDE_URL, target: '_blank', rel: 'noopener', text: 'Open the user guide (PDF)' }),
      h('button', { class: 'wide', text: 'Show the disclaimer', onclick: () => window.showDisclaimer && window.showDisclaimer() }),
    ], openSections.has('About'));
  }

  function renderSettings() {
    if (currentTab !== 'settings') return;
    const tab = $('tab-settings');
    tab.querySelectorAll('details.sec').forEach((d) => {
      const title = d.firstChild.textContent;
      if (d.open) openSections.add(title); else openSections.delete(title);
    });
    const top = tab.scrollTop;
    clear(tab);
    if (connected()) {
      [deviceSection, loraSection, channelsSection, networkSection, mqttSection, backupSection, radioSection, logSection, aboutSection]
        .forEach((make) => { try { tab.appendChild(make()); } catch (e) { console.error(e); tab.appendChild(h('p', { class: 'hint bad', text: 'A settings section could not be shown: ' + e.message })); } });
    } else {
      tab.appendChild(h('p', { class: 'muted', text: 'Connect to a radio to change its settings.' }));
      [backupSection, logSection, aboutSection].forEach((make) => tab.appendChild(make()));
    }
    tab.scrollTop = top;
  }

  // ── radio events ──────────────────────────────────────────────────────────
  let lastState = 'disconnected';
  let slowTimer = 0;
  Radio.on('state', (state) => {
    clearTimeout(slowTimer);
    if (state === 'configuring') {
      slowTimer = setTimeout(() => {
        if (Radio.state === 'configuring') {
          Radio.statusText = 'Still reading from the radio… If the phone asked for a pairing PIN, enter it. If nothing happens, cancel and connect again.';
          renderRadio();
        }
      }, 40000);
    }
    if (state === 'connected' && lastState !== 'connected') {
      loadMsgs();
      if (!conversations().includes(convKey)) convKey = 'c0';
      if (!isDemo() && !['UNSET', undefined].includes((Radio.config.lora || {}).region)) {
        Backup.capture('on-connect', false).then((data) => Backup.store(data)).catch((e) => console.warn('auto backup', e));
      }
    }
    lastState = state;
    renderRadio(); renderConvBar(); renderMsgs(); renderNodes(); renderSettings();
    if (currentTab === 'map') updateMarkers(state === 'connected');
  });
  Radio.on('nodes', nodesChanged);
  Radio.on('telemetry', () => { if (currentTab === 'radio') renderRadio(); });
  Radio.on('config', () => { renderRadio(); renderConvBar(); renderSettings(); });
  Radio.on('notice', (text) => toast(text));
  Radio.on('log', () => { if (logBox && logBox.isConnected && logBox.parentNode.parentNode.open) { logBox.textContent = logText(); logBox.scrollTop = logBox.scrollHeight; } });
  setInterval(() => { if (currentTab === 'nodes' && connected()) renderNodes(); }, 60000);

  renderRadio(); renderConvBar(); renderMsgs();
  if (/[?&]demo\b/.test(location.search)) connectDemo();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  window.MeshApp = { showTab, version: APP_VERSION };
})();
