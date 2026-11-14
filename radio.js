// Talks to one Meshtastic radio: the Bluetooth link, the client protocol
// (config download, packets, admin messages) and the radio's state.
//
//   Radio.connect(new BleTransport())      Radio.on('state', fn)
//   Radio.sendText(text, toNum, channel)   Radio.saveSettings([...steps])
//
// The protocol mirrors the meshtastic Python library the desktop program uses.
(function () {
  'use strict';

  const SERVICE = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
  const TORADIO = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
  const FROMRADIO = '2c55e69e-4993-11ed-b878-0242ac120002';
  const FROMNUM = 'ed9da18c-a800-4f66-a670-aa7547e34453';
  const BROADCAST = 0xffffffff;
  const WRITE_PAUSE_MS = 300;        // between admin messages, so the radio's queue keeps up
  const ADMIN_TIMEOUT_MS = 8000;
  const PAIRING_WAIT_MS = 90000;     // how long to keep trying while the user enters the PIN

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Bluetooth transport ───────────────────────────────────────────────────
  // A transport has open(), write(bytes), close(), and calls onFrame(bytes) / onClose(reason).
  function BleTransport() {
    this.kind = 'Bluetooth';
    this.device = null;
    this.chain = Promise.resolve();   // GATT allows one operation at a time
    this.drainQueued = false;
    this.closing = false;
    this.onFrame = () => {};
    this.onClose = () => {};
    this.onStatus = () => {};         // (text for the screen, line for the log)
    this.opening = false;
    this.pollTimer = 0;
    this._disconnected = () => { if (!this.closing && !this.opening) this.onClose('The Bluetooth link to the radio dropped.'); };
    this._notified = () => this.drain();
  }
  BleTransport.supported = () => !!(navigator.bluetooth && navigator.bluetooth.requestDevice);

  BleTransport.prototype.pick = async function () {
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }] });
    this.name = this.device.name || 'radio';
  };

  // The radio's characteristics are encrypted, so the first time a phone touches
  // them it must pair. On iPhone (and some Androids) that first operation fails
  // straight away while the PIN prompt is still on screen, and the link may drop
  // and come back once the PIN is entered. Hanging up at that point would dismiss
  // the prompt, so keep the link, wait, and try again until pairing has finished.
  BleTransport.prototype.open = async function () {
    if (!this.device) await this.pick();
    this.closing = false;
    this.opening = true;                  // link drops while pairing are expected: don't report them
    this.chain = Promise.resolve();
    this.device.removeEventListener('gattserverdisconnected', this._disconnected);
    this.device.addEventListener('gattserverdisconnected', this._disconnected);
    const deadline = Date.now() + PAIRING_WAIT_MS;
    let lastError = null, linked = false;
    try {
      for (let attempt = 1; ; attempt++) {
        if (this.closing) throw new Error('Cancelled');
        try {
          if (!this.device.gatt.connected || !linked) {
            const server = this.device.gatt.connected ? this.device.gatt : await this.device.gatt.connect();
            const service = await server.getPrimaryService(SERVICE);
            this.toRadio = await service.getCharacteristic(TORADIO);
            this.fromRadio = await service.getCharacteristic(FROMRADIO);
            this.fromNum = await service.getCharacteristic(FROMNUM);
            linked = true;
          }
          await this.fromRadio.readValue();           // proves the link is paired and encrypted
          this.fromNum.removeEventListener('characteristicvaluechanged', this._notified);
          this.fromNum.addEventListener('characteristicvaluechanged', this._notified);
          try { await this.fromNum.startNotifications(); } catch (e) {
            // Some browsers can't subscribe; poll instead so messages still arrive.
            this.onStatus('', 'Notifications unavailable (' + ((e && e.message) || e) + '); polling the radio instead');
            clearInterval(this.pollTimer);
            this.pollTimer = setInterval(() => { if (!this.closing && !this.opening) this.drain(); }, 3000);
          }
          return;
        } catch (e) {
          lastError = e;
          if (this.closing) throw new Error('Cancelled');
          if (e && (e.name === 'NotFoundError' || e.name === 'SecurityError') && !/auth|encrypt|pair/i.test(e.message || '')) throw e;
          if (Date.now() > deadline) throw e;
          if (!this.device.gatt.connected) linked = false;
          this.onStatus('Waiting for pairing… If the phone shows a PIN prompt, enter the 6-digit PIN from the radio’s screen ' +
            '(123456 on radios without a screen). Still trying, attempt ' + (attempt + 1) + '.',
          'Bluetooth not ready (attempt ' + attempt + '): ' + ((e && e.message) || e));
          await sleep(2500);
        }
      }
    } finally {
      this.opening = false;
      if (lastError && !this.device.gatt.connected) linked = false;
    }
  };

  BleTransport.prototype._queue = function (op) {
    const run = this.chain.then(op, op);
    this.chain = run.catch(() => {});
    return run;
  };

  BleTransport.prototype.write = function (bytes) {
    const done = this._queue(() => (this.toRadio.writeValueWithResponse
      ? this.toRadio.writeValueWithResponse(bytes) : this.toRadio.writeValue(bytes)));
    done.then(() => this.drain(), () => {});
    return done;
  };

  // Read FROMRADIO until the radio has nothing more to hand over.
  BleTransport.prototype.drain = function () {
    if (this.drainQueued) return;
    this.drainQueued = true;
    this._queue(async () => {
      this.drainQueued = false;
      for (;;) {
        const v = await this.fromRadio.readValue();
        if (!v.byteLength) break;
        this.onFrame(new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice());
      }
    }).catch((e) => { this.drainQueued = false; if (!this.closing) console.warn('BLE read failed', e); });
  };

  BleTransport.prototype.close = function () {
    this.closing = true;
    clearInterval(this.pollTimer);
    try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) { /* gone */ }
  };

  // ── radio state and protocol ──────────────────────────────────────────────
  const listeners = {};
  const Radio = {
    BROADCAST,
    state: 'disconnected',            // disconnected | connecting | configuring | connected | rebooting
    statusText: '',
    transport: null,
    myNum: 0, myInfo: null, metadata: null,
    nodes: new Map(), channels: [], config: {}, moduleConfig: {},
    log: [],
    sessionKey: null,
    on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); },
  };
  function emit(evt, arg) { (listeners[evt] || []).forEach((fn) => { try { fn(arg); } catch (e) { console.error(e); } }); }
  function setState(state, text) { Radio.state = state; Radio.statusText = text || ''; emit('state', state); }
  function logLine(text) {
    Radio.log.push({ t: Date.now(), text });
    if (Radio.log.length > 500) Radio.log.splice(0, Radio.log.length - 500);
    emit('log', text);
  }
  Radio.logLine = logLine;

  let configId = 0;
  let pending = {};                   // packet id -> {resolve, reject, timer, wantAdmin}
  let reconnecting = false;
  let userClosed = false;

  function resetState() {
    Radio.myNum = 0; Radio.myInfo = null; Radio.metadata = null;
    Radio.nodes = new Map(); Radio.channels = []; Radio.config = {}; Radio.moduleConfig = {};
    Radio.sessionKey = null;
    Object.values(pending).forEach((p) => { clearTimeout(p.timer); p.reject(new Error('Disconnected')); });
    pending = {};
  }

  function newId() {
    const a = new Uint32Array(1);
    do { crypto.getRandomValues(a); } while (!a[0]);
    return a[0];
  }

  function describeError(e) {
    const msg = (e && e.message) || String(e);
    if (e && e.name === 'NotFoundError') return 'No radio was chosen.';
    if (/auth|encrypt|pair|GATT Server is disconnected|NetworkError|Connection attempt failed|disconnected|not connected|unknown/i.test(msg) ||
        (e && (e.name === 'NetworkError' || e.name === 'NotSupportedError' || e.name === 'InvalidStateError'))) {
      return 'Could not finish connecting to the radio over Bluetooth. Check that it is powered on, in range, and not connected ' +
        'to another phone or app (close the Meshtastic app). If the PIN prompt disappeared before you could type, or the PIN was ' +
        'refused: open the phone’s Settings › Bluetooth, find the radio, choose “Forget This Device”, then connect ' +
        'again and enter the 6-digit PIN shown on the radio’s screen. (' + msg + ')';
    }
    if (e && e.name === 'SecurityError') return 'Bluetooth permission was refused by the browser. (' + msg + ')';
    return msg;
  }
  Radio.describeError = describeError;

  async function startConfig() {
    configId = newId();
    setState('configuring', 'Reading the radio’s nodes and settings…');
    await Radio.transport.write(PB.encode('ToRadio', { want_config_id: configId }));
  }

  Radio.connect = async function (transport) {
    if (Radio.state !== 'disconnected') await Radio.disconnect();
    userClosed = false;
    resetState();
    Radio.transport = transport;
    transport.onFrame = handleFrame;
    transport.onClose = handleClose;
    transport.onStatus = (text, line) => {
      if (line) logLine(line);
      if (text && Radio.transport === transport && Radio.state !== 'connected') setState(Radio.state, text);
    };
    setState('connecting', 'Connecting…');
    try {
      await transport.open();
      logLine('Connected to ' + (transport.name || 'radio') + ' over ' + transport.kind);
      await startConfig();
    } catch (e) {
      if (userClosed || Radio.transport !== transport) return;      // the user pressed Cancel
      Radio.transport = null;
      try { transport.close(); } catch (e2) { /* never opened */ }
      logLine('Connect failed: ' + ((e && e.name) || '') + ' ' + ((e && e.message) || e));
      setState('disconnected', describeError(e));
      throw new Error(describeError(e));
    }
  };

  Radio.disconnect = async function () {
    userClosed = true;
    reconnecting = false;
    const t = Radio.transport;
    Radio.transport = null;
    if (t) {
      try { await t.write(PB.encode('ToRadio', { disconnect: true })); } catch (e) { /* already gone */ }
      t.close();
    }
    resetState();
    setState('disconnected', '');
    emit('nodes');
  };

  // The link dropped. After a settings save the radio is rebooting, so keep trying
  // to get it back; a plain drop gets a few quick attempts too (radios nap).
  async function handleClose(reason) {
    if (userClosed || reconnecting || !Radio.transport) return;
    const t = Radio.transport;
    const wasRebooting = Radio.state === 'rebooting';
    reconnecting = true;
    logLine(reason || 'Link closed');
    Object.values(pending).forEach((p) => { clearTimeout(p.timer); p.reject(new Error('Disconnected')); });
    pending = {};
    const attempts = wasRebooting ? 12 : 4;
    for (let i = 1; i <= attempts && !userClosed && Radio.transport === t; i++) {
      setState('rebooting', (wasRebooting ? 'The radio is restarting' : 'Connection lost') +
        '. Reconnecting (try ' + i + ' of ' + attempts + ')… Bluetooth can take a minute; be patient.');
      await sleep(wasRebooting && i === 1 ? 8000 : 5000);
      if (userClosed || Radio.transport !== t) break;
      try {
        await t.open();
        reconnecting = false;
        logLine('Reconnected');
        Radio.sessionKey = null;
        await startConfig();
        return;
      } catch (e) {
        logLine('Reconnect failed: ' + ((e && e.message) || e));
      }
    }
    reconnecting = false;
    if (userClosed || Radio.transport !== t) return;
    Radio.transport = null;
    t.close();
    resetState();
    setState('disconnected', 'The radio did not come back. Press Connect to try again.');
    emit('nodes');
  }

  // ── incoming ──────────────────────────────────────────────────────────────
  function node(num) {
    let n = Radio.nodes.get(num);
    if (!n) { n = { num }; Radio.nodes.set(num, n); }
    return n;
  }

  function handleFrame(bytes) {
    let fr;
    try { fr = PB.decode('FromRadio', bytes); } catch (e) { logLine('Unreadable frame from radio: ' + e.message); return; }
    if (fr.my_info) {
      Radio.myInfo = fr.my_info; Radio.myNum = fr.my_info.my_node_num >>> 0;
    } else if (fr.metadata) {
      Radio.metadata = fr.metadata;
    } else if (fr.node_info) {
      Object.assign(node(fr.node_info.num >>> 0), fr.node_info);
      if (Radio.state === 'connected') emit('nodes');
    } else if (fr.config) {
      Object.keys(fr.config).forEach((k) => { if (k !== '_unknown') Radio.config[k] = fr.config[k]; });
    } else if (fr.moduleConfig) {
      Object.keys(fr.moduleConfig).forEach((k) => { if (k !== '_unknown') Radio.moduleConfig[k] = fr.moduleConfig[k]; });
    } else if (fr.channel) {
      Radio.channels[fr.channel.index || 0] = fr.channel;
    } else if (fr.config_complete_id !== undefined) {
      if (fr.config_complete_id === configId) {
        for (let i = 0; i < Radio.channels.length; i++) if (!Radio.channels[i]) Radio.channels[i] = { index: i };
        setState('connected', '');
        logLine('Radio ready: ' + Radio.nodes.size + ' nodes');
        emit('nodes'); emit('config');
      }
    } else if (fr.packet) {
      handlePacket(fr.packet);
    } else if (fr.log_record) {
      logLine('[radio] ' + (fr.log_record.message || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim());
    } else if (fr.queueStatus) {
      if (fr.queueStatus.res) logLine('Radio refused a packet (queue result ' + fr.queueStatus.res + ')');
    } else if (fr.rebooted) {
      logLine('Radio rebooted');
      if (Radio.transport && !reconnecting) startConfig().catch(() => {});
    } else if (fr.clientNotification) {
      const text = fr.clientNotification.message || '';
      if (text) { logLine('[radio notice] ' + text); emit('notice', text); }
    }
  }

  function settle(id, fn) {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    clearTimeout(p.timer);
    fn(p);
  }

  function handlePacket(p) {
    const from = (p.from || 0) >>> 0, to = (p.to || 0) >>> 0;
    const d = p.decoded;
    if (from && from !== Radio.myNum) {
      const n = node(from);
      n.last_heard = p.rx_time || Math.floor(Date.now() / 1000);
      if (p.rx_snr !== undefined) n.snr = p.rx_snr;
      if (p.hop_start) n.hops_away = Math.max(0, p.hop_start - (p.hop_limit || 0));
      if (p.channel !== undefined || !('heard_channel' in n)) n.heard_channel = p.channel || 0;
    }
    if (!d) return;                                    // still encrypted: not for us
    let body;
    try {
      switch (d.portnum) {
        case 'TEXT_MESSAGE_APP':
          emit('message', { id: (p.id || 0) >>> 0, from, to, channel: p.channel || 0,
            text: new TextDecoder().decode(d.payload || new Uint8Array()),
            time: (p.rx_time || Math.floor(Date.now() / 1000)) * 1000, incoming: true });
          break;
        case 'POSITION_APP':
          body = PB.decode('Position', d.payload || new Uint8Array());
          if (body.latitude_i !== undefined) { node(from).position = body; emit('nodes'); }
          break;
        case 'NODEINFO_APP':
          node(from).user = PB.decode('User', d.payload || new Uint8Array());
          emit('nodes');
          break;
        case 'TELEMETRY_APP':
          body = PB.decode('Telemetry', d.payload || new Uint8Array());
          if (body.device_metrics) {
            node(from || Radio.myNum).device_metrics = body.device_metrics;
            emit('nodes');
            if (!from || from === Radio.myNum) emit('telemetry');
          }
          break;
        case 'ROUTING_APP': {
          body = PB.decode('Routing', d.payload || new Uint8Array());
          const reason = body.error_reason === undefined ? 'NONE' : body.error_reason;
          const req = (d.request_id || 0) >>> 0;
          emit('ack', { id: req, ok: reason === 'NONE', reason, from });
          const w = pending[req];
          if (w && reason !== 'NONE') settle(req, (x) => x.reject(new Error('The radio answered ' + reason)));
          else if (w && !w.wantAdmin) settle(req, (x) => x.resolve(null));
          break;                                       // an admin request keeps waiting for its real reply
        }
        case 'ADMIN_APP': {
          body = PB.decode('AdminMessage', d.payload || new Uint8Array());
          if (body.session_passkey && body.session_passkey.length) Radio.sessionKey = body.session_passkey;
          settle((d.request_id || 0) >>> 0, (w) => w.resolve(body));
          break;
        }
        default: break;
      }
    } catch (e) {
      logLine('Could not read a ' + d.portnum + ' packet: ' + e.message);
    }
  }

  // ── outgoing ──────────────────────────────────────────────────────────────
  function requireLink() {
    if (!Radio.transport || (Radio.state !== 'connected' && Radio.state !== 'configuring')) {
      throw new Error('Not connected to a radio.');
    }
  }

  async function sendPacket(packet) {
    requireLink();
    if (!packet.id) packet.id = newId();
    if (packet.hop_limit === undefined) {
      const hops = Radio.config.lora && Radio.config.lora.hop_limit;
      packet.hop_limit = hops || 3;
    }
    await Radio.transport.write(PB.encode('ToRadio', { packet }));
    return packet.id;
  }

  // Send a text. to = node number or Radio.BROADCAST. Returns the packet id; the
  // 'ack' event later says whether it was delivered.
  Radio.sendText = function (text, to, channel) {
    const payload = new TextEncoder().encode(text);
    if (payload.length > 200) throw new Error('Message is too long (' + payload.length + ' of 200 bytes).');
    return sendPacket({ to: to === undefined ? BROADCAST : to, channel: channel || 0, want_ack: true,
      decoded: { portnum: 'TEXT_MESSAGE_APP', payload } });
  };

  // Send an admin message to the connected radio. With wantResponse the promise
  // resolves to the radio's AdminMessage reply.
  async function admin(msg, wantResponse) {
    requireLink();
    const body = Object.assign({}, msg);
    if (Radio.sessionKey) body.session_passkey = Radio.sessionKey;
    const id = newId();
    let waiter = null;
    if (wantResponse) {
      waiter = new Promise((resolve, reject) => {
        pending[id] = { resolve, reject, wantAdmin: true,
          timer: setTimeout(() => settle(id, (w) => w.reject(new Error('No reply from the radio'))), ADMIN_TIMEOUT_MS) };
      });
      waiter.catch(() => {});
    }
    await sendPacket({ id, to: Radio.myNum, channel: 0, want_ack: true, pki_encrypted: true,
      decoded: { portnum: 'ADMIN_APP', payload: PB.encode('AdminMessage', body), want_response: !!wantResponse } });
    return waiter;
  }
  Radio.admin = admin;

  async function ensureSessionKey() {
    try { await admin({ get_config_request: 'SESSIONKEY_CONFIG' }, true); } catch (e) { /* older firmware: no session keys */ }
  }

  // Write settings in one transaction, so the radio saves (and reboots, if it
  // needs to) once. steps: [{label, admin: {...AdminMessage fields}}].
  // onStep(label) reports progress.
  Radio.saveSettings = async function (steps, onStep) {
    requireLink();
    if (Radio.state !== 'connected') throw new Error('Wait for the radio to finish connecting.');
    const step = onStep || (() => {});
    await ensureSessionKey();
    await admin({ begin_edit_settings: true });
    await sleep(WRITE_PAUSE_MS);
    for (const s of steps) {
      step(s.label);
      await admin(s.admin);
      if (s.apply) s.apply();
      await sleep(WRITE_PAUSE_MS);
    }
    step('saving on the radio');
    await admin({ commit_edit_settings: true });
    logLine('Saved: ' + steps.map((s) => s.label).join(', '));
    emit('config');
  };

  // Call after a save that makes the radio restart, so the dropped link is
  // treated as the reboot it is.
  Radio.expectReboot = function () {
    if (Radio.state === 'connected') setState('rebooting', 'The radio is saving and may restart…');
    setTimeout(() => {              // it didn't restart after all (nothing needed a reboot)
      if (Radio.state === 'rebooting' && !reconnecting && Radio.transport) setState('connected', '');
    }, 12000);
  };

  // Channels are written one at a time, outside a transaction: no reboot.
  Radio.writeChannel = async function (channel) {
    requireLink();
    await ensureSessionKey();
    await admin({ set_channel: channel });
    Radio.channels[channel.index || 0] = channel;
    logLine('Saved channel ' + (channel.index || 0));
    emit('config');
  };

  // Delete a secondary channel: the ones above it move down a slot, as the firmware expects.
  Radio.deleteChannel = async function (index) {
    const list = Radio.channels.slice();
    if (!list[index] || list[index].role !== 'SECONDARY') throw new Error('Only secondary channels can be deleted.');
    list.splice(index, 1);
    list.push({ role: 'DISABLED' });
    await ensureSessionKey();
    for (let i = index; i < list.length; i++) {
      const ch = Object.assign({}, list[i], { index: i });
      if (!i) delete ch.index;
      await admin({ set_channel: ch });
      Radio.channels[i] = ch;
      await sleep(WRITE_PAUSE_MS);
    }
    logLine('Deleted channel ' + index);
    emit('config');
  };

  Radio.getCannedMessages = async function () {
    const r = await admin({ get_canned_message_module_messages_request: true }, true);
    return (r && r.get_canned_message_module_messages_response) || '';
  };
  Radio.getRingtone = async function () {
    const r = await admin({ get_ringtone_request: true }, true);
    return (r && r.get_ringtone_response) || '';
  };
  Radio.reboot = async function (secs) {
    await ensureSessionKey();
    await admin({ reboot_seconds: secs || 5 });
    Radio.expectReboot();
  };

  // ── helpers the screens share ─────────────────────────────────────────────
  Radio.nodeId = (num) => '!' + (num >>> 0).toString(16).padStart(8, '0');
  Radio.nodeName = function (num) {
    if (num === BROADCAST) return 'Everyone';
    const n = Radio.nodes.get(num);
    return (n && n.user && (n.user.long_name || n.user.short_name)) || Radio.nodeId(num);
  };
  Radio.me = () => Radio.nodes.get(Radio.myNum) || null;
  Radio.position = function (n) {
    const p = n && n.position;
    if (!p || p.latitude_i === undefined || p.longitude_i === undefined) return null;
    if (!p.latitude_i && !p.longitude_i) return null;
    return { lat: p.latitude_i * 1e-7, lon: p.longitude_i * 1e-7, alt: p.altitude || 0 };
  };
  Radio.channelName = function (index) {
    const ch = Radio.channels[index];
    const name = ch && ch.settings && ch.settings.name;
    if (name) return name;
    if (!index) {
      const lora = Radio.config.lora || {};
      if (lora.use_preset === false) return 'Custom';
      return (lora.modem_preset || 'LONG_FAST').toLowerCase().split('_')
        .map((w) => w[0].toUpperCase() + w.slice(1)).join('');
    }
    return 'Channel ' + index;
  };

  window.Radio = Radio;
  window.BleTransport = BleTransport;
})();
