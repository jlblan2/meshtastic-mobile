// A pretend radio, for trying the app without one (and for testing it on a PC).
// It speaks the same protocol as a real radio: answers the config download,
// acknowledges messages, accepts settings, and "reboots" after a save.
// Every node, name and position in here is made up.
(function () {
  'use strict';
  const MY = 0x0a11ce01;
  const b64 = (s) => PB.b64ToBytes(s);
  const now = () => Math.floor(Date.now() / 1000);

  function freshState() {
    const nodes = [
      { num: MY, user: { id: '!0a11ce01', long_name: 'Demo Base', short_name: 'DEMO', hw_model: 'HELTEC_V3', role: 'CLIENT' },
        position: { latitude_i: 279500000, longitude_i: -825400000, altitude: 6 },
        device_metrics: { battery_level: 87, voltage: 4.05, channel_utilization: 4.2, air_util_tx: 0.6, uptime_seconds: 86400 } },
      { num: 0x0b0b0002, user: { id: '!0b0b0002', long_name: 'Harbor Relay', short_name: 'HRBR', hw_model: 'RAK4631', role: 'ROUTER' },
        position: { latitude_i: 279760000, longitude_i: -825010000, altitude: 30 }, snr: 9.25, last_heard: now() - 40, hops_away: 0,
        device_metrics: { battery_level: 101, voltage: 4.2 } },
      { num: 0x0b0b0003, user: { id: '!0b0b0003', long_name: 'Patrol Boat 1', short_name: 'PB1', hw_model: 'T_ECHO', role: 'CLIENT' },
        position: { latitude_i: 279120000, longitude_i: -826200000, altitude: 2 }, snr: 3.5, last_heard: now() - 300, hops_away: 1,
        device_metrics: { battery_level: 62, voltage: 3.85 } },
      { num: 0x0b0b0004, user: { id: '!0b0b0004', long_name: 'Shore Station', short_name: 'SHOR', hw_model: 'TBEAM', role: 'CLIENT' },
        position: { latitude_i: 280350000, longitude_i: -824700000, altitude: 12 }, snr: -4.75, last_heard: now() - 3600, hops_away: 2 },
      { num: 0x0b0b0005, user: { id: '!0b0b0005', long_name: 'Tracker 5', short_name: 'TR5', hw_model: 'TRACKER_T1000_E', role: 'TRACKER' },
        snr: -11.5, last_heard: now() - 86400 * 2, hops_away: 3, via_mqtt: true },
      { num: 0x0b0b0006, snr: 1.0, last_heard: now() - 7200, hops_away: 1 },
    ];
    return {
      nodes,
      owner: nodes[0].user,
      config: {
        device: { role: 'CLIENT', node_info_broadcast_secs: 10800 },
        position: { position_broadcast_secs: 900, gps_update_interval: 120, fixed_position: true },
        power: { wait_bluetooth_secs: 60, sds_secs: 4294967295, ls_secs: 300, min_wake_secs: 10 },
        network: { ntp_server: 'meshtastic.pool.ntp.org', wifi_ssid: '', address_mode: 'DHCP' },
        display: { screen_on_secs: 600 },
        lora: { use_preset: true, modem_preset: 'LONG_FAST', region: 'US', hop_limit: 3, tx_enabled: true, tx_power: 30,
          channel_num: 20, sx126x_rx_boosted_gain: true },
        bluetooth: { enabled: true, mode: 'FIXED_PIN', fixed_pin: 123456 },
        security: { public_key: b64('3q2+78r+ur7erb7vyv66vt6tvu/K/rq+3q2+78r+ur4='), private_key: b64('AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA='), serial_enabled: true },
      },
      moduleConfig: {
        mqtt: { address: 'mqtt.meshtastic.org', username: 'meshdev', password: 'large4cats', encryption_enabled: true, root: 'msh/US' },
        serial: {}, external_notification: {}, store_forward: {}, range_test: {},
        telemetry: { device_update_interval: 1800 }, canned_message: {}, audio: {}, remote_hardware: {},
        neighbor_info: {}, ambient_lighting: {}, detection_sensor: {}, paxcounter: {},
      },
      channels: [
        { role: 'PRIMARY', settings: { psk: Uint8Array.of(1), module_settings: { position_precision: 13 } } },
        { index: 1, role: 'SECONDARY', settings: { name: 'Flotilla', psk: b64('q83vq83vq83vq83vq83vq83vq83vq83vq83vq83vq80='), module_settings: { position_precision: 32 } } },
        { index: 2 }, { index: 3 }, { index: 4 }, { index: 5 }, { index: 6 }, { index: 7 },
      ],
      canned: 'Yes|No|On my way|Standing by',
      ringtone: '',
    };
  }

  let radioState = null;            // survives a "reboot" while the page stays open

  function DemoTransport() {
    this.kind = 'demo';
    this.name = 'Demo radio';
    this.onFrame = () => {};
    this.onClose = () => {};
    this.open_ = false;
    this.timers = [];
    this.dirty = false;
  }

  DemoTransport.prototype.open = async function () {
    if (!radioState) radioState = freshState();
    await new Promise((r) => setTimeout(r, 300));
    this.open_ = true;
    this.frameId = 1;
  };
  DemoTransport.prototype.close = function () {
    this.open_ = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
  };
  DemoTransport.prototype.later = function (ms, fn) {
    this.timers.push(setTimeout(() => { if (this.open_) fn(); }, ms));
  };
  DemoTransport.prototype.emit = function (fields) {
    if (!this.open_) return;
    this.onFrame(PB.encode('FromRadio', Object.assign({ id: this.frameId++ }, fields)));
  };
  DemoTransport.prototype.packet = function (from, to, portnum, typeName, body, extra) {
    this.emit({ packet: Object.assign({ from, to, id: (Math.random() * 0xffffffff) >>> 0, rx_time: now(),
      decoded: Object.assign({ portnum, payload: typeName ? PB.encode(typeName, body) : body }, extra || {}) },
      from !== MY ? { rx_snr: 6.5, hop_limit: 2, hop_start: 3 } : {}) });
  };

  DemoTransport.prototype.write = async function (bytes) {
    if (!this.open_) throw new Error('Demo radio is off');
    const msg = PB.decode('ToRadio', bytes);
    if (msg.want_config_id !== undefined) this.sendConfig(msg.want_config_id);
    else if (msg.packet) this.later(120, () => this.handlePacket(msg.packet));
  };

  DemoTransport.prototype.sendConfig = function (id) {
    const s = radioState;
    this.later(50, () => {
      this.emit({ my_info: { my_node_num: MY, reboot_count: 7, min_app_version: 30200, pio_env: 'heltec-v3', nodedb_count: s.nodes.length } });
      this.emit({ metadata: { firmware_version: '2.7.26.demo', device_state_version: 24, hasWifi: true, hasBluetooth: true,
        hw_model: 'HELTEC_V3', role: s.config.device.role, hasPKC: true } });
      s.nodes.forEach((n) => this.emit({ node_info: n }));
      Object.keys(s.config).forEach((k) => this.emit({ config: { [k]: s.config[k] } }));
      Object.keys(s.moduleConfig).forEach((k) => this.emit({ moduleConfig: { [k]: s.moduleConfig[k] } }));
      s.channels.forEach((ch) => this.emit({ channel: ch }));
      this.emit({ config_complete_id: id });
    });
    this.later(9000, () => this.packet(0x0b0b0003, 0xffffffff, 'TEXT_MESSAGE_APP', null,
      new TextEncoder().encode('Patrol Boat 1 on station, all quiet.')));
  };

  DemoTransport.prototype.ack = function (p, reason) {
    this.emit({ queueStatus: { free: 15, maxlen: 16, mesh_packet_id: p.id } });
    this.packet(p.to === 0xffffffff || p.to === MY ? MY : p.to, MY, 'ROUTING_APP', 'Routing',
      { error_reason: reason || 'NONE' }, { request_id: p.id });
  };

  DemoTransport.prototype.handlePacket = function (p) {
    const s = radioState, d = p.decoded || {};
    if (d.portnum === 'TEXT_MESSAGE_APP') {
      const known = p.to === 0xffffffff || s.nodes.some((n) => n.num === p.to);
      this.later(900, () => this.ack(p, known ? 'NONE' : 'NO_ROUTE'));
      if (p.to !== 0xffffffff && known && p.to !== MY) {
        this.later(3500, () => this.emit({ packet: { from: p.to, to: MY, id: (Math.random() * 0xffffffff) >>> 0, rx_time: now(),
          rx_snr: 5, hop_limit: 3, hop_start: 3,
          decoded: { portnum: 'TEXT_MESSAGE_APP', payload: new TextEncoder().encode('Copy: "' + new TextDecoder().decode(d.payload) + '"') } } }));
      }
      return;
    }
    if (d.portnum !== 'ADMIN_APP') return;
    const a = PB.decode('AdminMessage', d.payload || new Uint8Array());
    const reply = (body) => this.packet(MY, MY, 'ADMIN_APP', 'AdminMessage',
      Object.assign({ session_passkey: Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8) }, body), { request_id: p.id });
    this.ack(p);
    if (a.get_config_request === 'SESSIONKEY_CONFIG') reply({ get_config_response: { sessionkey: {} } });
    else if (a.get_canned_message_module_messages_request) reply({ get_canned_message_module_messages_response: s.canned });
    else if (a.get_ringtone_request) reply({ get_ringtone_response: s.ringtone });
    else if (a.set_owner) { Object.assign(s.owner, a.set_owner); this.dirty = true; }
    else if (a.set_config) { Object.keys(a.set_config).forEach((k) => { if (k !== '_unknown') s.config[k] = a.set_config[k]; }); this.dirty = true; }
    else if (a.set_module_config) { Object.keys(a.set_module_config).forEach((k) => { if (k !== '_unknown') s.moduleConfig[k] = a.set_module_config[k]; }); this.dirty = true; }
    else if (a.set_channel) s.channels[a.set_channel.index || 0] = a.set_channel;
    else if (a.set_fixed_position) s.nodes[0].position = a.set_fixed_position;
    else if (a.set_canned_message_module_messages !== undefined) s.canned = a.set_canned_message_module_messages;
    else if (a.set_ringtone_message !== undefined) s.ringtone = a.set_ringtone_message;
    else if ((a.commit_edit_settings && this.dirty) || a.reboot_seconds !== undefined) {
      this.dirty = false;
      this.later(1200, () => { this.close(); this.onClose('The demo radio is restarting.'); });
    }
  };

  DemoTransport.reset = () => { radioState = null; };
  window.DemoTransport = DemoTransport;
})();
