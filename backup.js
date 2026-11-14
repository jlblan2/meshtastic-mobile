// Save and restore a radio's settings (not its firmware). Same file format as the
// desktop program's settings_backup.py, so a backup made on either can be restored
// by the other.
//
// A backup holds the radio's private key, channel keys and any WiFi/MQTT passwords.
(function () {
  'use strict';
  const FORMAT = 'meshtastic-gui-settings';
  const FORMAT_VERSION = 1;
  const SKIP_SECTIONS = ['version', 'sessionkey', 'device_ui'];
  const IDENTITY_FIELDS = ['private_key', 'public_key'];
  const STORE_KEY = 'meshmobile.backups';
  const KEEP = 12;

  function deviceInfo() {
    const me = Radio.me() || {};
    const user = me.user || {};
    return {
      node_id: Radio.nodeId(Radio.myNum),
      long_name: user.long_name || '', short_name: user.short_name || '',
      hw_model: String(user.hw_model || (Radio.metadata && Radio.metadata.hw_model) || ''),
      firmware: (Radio.metadata && Radio.metadata.firmware_version) || '',
      pio_env: (Radio.myInfo && Radio.myInfo.pio_env) || '',
    };
  }

  function localStamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // Everything needed to put this radio's settings back, as a JSON-ready object.
  async function capture(reason, includeExtras) {
    if (Radio.state !== 'connected') throw new Error("The radio's settings haven't been read yet. Wait for the connection to finish.");
    const me = Radio.me() || {};
    const user = me.user || {};
    const data = {
      format: FORMAT, format_version: FORMAT_VERSION,
      created: localStamp(new Date()), reason: reason || 'manual',
      device: deviceInfo(),
      owner: { long_name: user.long_name || '', short_name: user.short_name || '',
        is_licensed: !!user.is_licensed, is_unmessagable: !!user.is_unmessagable },
      config: {}, module_config: {}, channels: [],
      fixed_position: null, canned_messages: null, ringtone: null,
    };
    PB.fieldNames('LocalConfig').forEach((name) => {
      if (SKIP_SECTIONS.includes(name) || !PB.fieldType('LocalConfig', name)) return;
      data.config[name] = PB.toJSON(PB.fieldType('LocalConfig', name), Radio.config[name] || {});
    });
    PB.fieldNames('LocalModuleConfig').forEach((name) => {
      if (SKIP_SECTIONS.includes(name) || !PB.fieldType('LocalModuleConfig', name)) return;
      data.module_config[name] = PB.toJSON(PB.fieldType('LocalModuleConfig', name), Radio.moduleConfig[name] || {});
    });
    Radio.channels.forEach((ch) => data.channels.push(PB.toJSON('Channel', ch)));
    if (Radio.config.position && Radio.config.position.fixed_position) {
      const pos = Radio.position(me);
      if (pos) data.fixed_position = { latitude: +pos.lat.toFixed(7), longitude: +pos.lon.toFixed(7), altitude: Math.trunc(pos.alt || 0) };
    }
    if (includeExtras !== false) {
      try { data.canned_messages = (await Radio.getCannedMessages()) || null; } catch (e) { /* module off */ }
      try { data.ringtone = (await Radio.getRingtone()) || null; } catch (e) { /* module off */ }
    }
    return data;
  }

  function check(data, name) {
    if (!data || typeof data !== 'object' || data.format !== FORMAT) {
      throw new Error((name || 'That file') + " isn't a settings backup made by this program.");
    }
    if ((data.format_version || 0) > FORMAT_VERSION) throw new Error('This backup was made by a newer version of this program.');
    return data;
  }

  const isUnconfigured = (data) => ['UNSET', 0, undefined].includes(((data.config || {}).lora || {}).region);

  function describe(data) {
    const d = data.device || {}, o = data.owner || {}, c = data.config || {};
    const chans = (data.channels || []).filter((ch) => (ch.role || 'DISABLED') !== 'DISABLED')
      .map((ch) => (ch.settings || {}).name || '(unnamed)');
    return [
      'Radio: ' + (o.long_name || '?') + ' (' + (o.short_name || '?') + ')  ' + (d.node_id || ''),
      'Saved: ' + String(data.created || '?').replace('T', ' ') + '  (' + (data.reason || '?') + '), firmware ' + (d.firmware || '?'),
      'Role ' + ((c.device || {}).role || 'CLIENT') + ', region ' + ((c.lora || {}).region || 'UNSET') +
        ', preset ' + ((c.lora || {}).modem_preset || 'LONG_FAST') +
        ', MQTT ' + (((data.module_config || {}).mqtt || {}).enabled ? 'on' : 'off'),
      'Channels: ' + (chans.length ? chans.join(', ') : 'none'),
    ].join('\n');
  }

  // Write a backup to the connected radio. includeIdentity=false leaves the radio's
  // own key pair alone (for copying settings onto a different radio).
  async function restore(data, includeIdentity, onStep) {
    check(data);
    const steps = [], written = [], skipped = [];
    function add(label, admin, done) {
      try { PB.encode('AdminMessage', admin); } catch (e) { skipped.push(label + ' (' + e.message + ')'); return; }
      steps.push({ label, admin });
      if (done) written.push(done);
    }
    const owner = data.owner || {};
    if ((owner.long_name || '').trim() && (owner.short_name || '').trim()) {
      add('owner name', { set_owner: { long_name: owner.long_name.trim(), short_name: owner.short_name.trim().slice(0, 4),
        is_licensed: !!owner.is_licensed, is_unmessagable: !!owner.is_unmessagable } }, 'owner name');
    }
    Object.keys(data.config || {}).forEach((name) => {
      if (SKIP_SECTIONS.includes(name)) return;
      if (!PB.hasField('Config', name)) { skipped.push(name + " (this app doesn't know it)"); return; }
      if (!(name in Radio.config)) { skipped.push(name + ' (not in the radio’s firmware)'); return; }
      const values = Object.assign({}, data.config[name]);
      if (name === 'security' && !includeIdentity) {
        const current = PB.toJSON('Config.SecurityConfig', Radio.config.security || {});
        IDENTITY_FIELDS.forEach((f) => { delete values[f]; if (f in current) values[f] = current[f]; });
      }
      add(name + ' settings', { set_config: { [name]: values } }, name);
    });
    Object.keys(data.module_config || {}).forEach((name) => {
      if (SKIP_SECTIONS.includes(name)) return;
      if (!PB.hasField('ModuleConfig', name)) { skipped.push(name + " (this app doesn't know it)"); return; }
      if (!(name in Radio.moduleConfig)) { skipped.push(name + ' (not in the radio’s firmware)'); return; }
      add(name + ' module', { set_module_config: { [name]: data.module_config[name] } }, name + ' module');
    });
    const saved = data.channels || [];
    saved.forEach((ch, i) => {
      if (i >= Radio.channels.length) { skipped.push('channel ' + i + ' (the radio has no slot for it)'); return; }
      const copy = Object.assign({}, ch, { index: i });
      add('channel ' + i, { set_channel: copy });
    });
    if (saved.length) written.push(saved.filter((c) => (c.role || 'DISABLED') !== 'DISABLED').length + ' channel(s)');
    const fixed = data.fixed_position;
    if (fixed) {
      add('fixed position', { set_fixed_position: { latitude_i: Math.round(fixed.latitude * 1e7),
        longitude_i: Math.round(fixed.longitude * 1e7), altitude: Math.trunc(fixed.altitude || 0) } }, 'fixed position');
    }
    if (data.canned_messages) {
      if (data.canned_messages.length > 200) skipped.push('canned messages (over 200 characters)');
      else add('canned messages', { set_canned_message_module_messages: data.canned_messages }, 'canned messages');
    }
    if (data.ringtone) {
      if (data.ringtone.length > 230) skipped.push('ringtone (over 230 characters)');
      else add('ringtone', { set_ringtone_message: data.ringtone }, 'ringtone');
    }
    await Radio.saveSettings(steps, onStep);
    Radio.expectReboot();
    return { written, skipped };
  }

  // ── kept on this phone ────────────────────────────────────────────────────
  function stored() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; }
  }
  function comparable(data) {
    const copy = Object.assign({}, data);
    delete copy.created; delete copy.reason; delete copy.device;
    return JSON.stringify(copy);
  }
  // Keep a backup on this phone (newest first). An automatic on-connect snapshot
  // identical to the newest one for that radio isn't stored twice.
  function store(data) {
    let list = stored();
    if (data.reason === 'on-connect') {
      const newest = list.find((b) => b.device.node_id === data.device.node_id);
      if (newest && comparable(newest) === comparable(data)) return false;
    }
    list.unshift(data);
    const auto = list.filter((b) => b.reason === 'on-connect');
    if (auto.length > KEEP) list = list.filter((b) => b.reason !== 'on-connect' || auto.indexOf(b) < KEEP);
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
    return true;
  }
  function remove(index) {
    const list = stored();
    list.splice(index, 1);
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  }

  function fileName(data) {
    const short = String((data.owner || {}).short_name || 'radio').replace(/[^\w-]/g, '_');
    const stamp = String(data.created || '').replace(/[-:]/g, '').replace('T', '_');
    return 'settings_' + short + '_' + stamp + '_' + (data.reason || 'manual') + '.json';
  }
  // Hand the backup to the phone as a file: the share sheet where there is one, else a download.
  async function exportFile(data) {
    const text = JSON.stringify(data, null, 2);
    const name = fileName(data);
    try {
      const file = new File([text], name, { type: 'application/json' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: name });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  window.Backup = { capture, check, describe, restore, stored, store, remove, exportFile, fileName, isUnconfigured };
})();
