// LoRa regional rules and network-address helpers, the same ones the desktop
// program uses (mesh_client.py). The radio never reports which presets, slots or
// power levels a region allows, so these mirror the Meshtastic firmware
// (RadioInterface.cpp region table, MeshRadio.h modemPresetToParams).
(function () {
  'use strict';

  // region -> [freq start MHz, freq end MHz, tx power limit dBm, duty cycle %, wide (2.4 GHz) LoRa]
  const REGIONS = {
    UNSET: [902.0, 928.0, 30, 100, false],   // firmware treats UNSET like US
    US: [902.0, 928.0, 30, 100, false],
    EU_433: [433.0, 434.0, 10, 10, false],
    EU_868: [869.4, 869.65, 27, 10, false],
    CN: [470.0, 510.0, 19, 100, false],
    JP: [920.5, 923.5, 13, 100, false],
    ANZ: [915.0, 928.0, 30, 100, false],
    ANZ_433: [433.05, 434.79, 14, 100, false],
    RU: [868.7, 869.2, 20, 100, false],
    KR: [920.0, 923.0, 23, 100, false],
    TW: [920.0, 925.0, 27, 100, false],
    IN: [865.0, 867.0, 30, 100, false],
    NZ_865: [864.0, 868.0, 36, 100, false],
    TH: [920.0, 925.0, 27, 10, false],
    UA_433: [433.0, 434.7, 10, 10, false],
    UA_868: [868.0, 868.6, 14, 1, false],
    MY_433: [433.0, 435.0, 20, 100, false],
    MY_919: [919.0, 924.0, 27, 100, false],
    SG_923: [917.0, 925.0, 20, 100, false],
    PH_433: [433.0, 434.7, 10, 100, false],
    PH_868: [868.0, 869.4, 14, 100, false],
    PH_915: [915.0, 918.0, 24, 100, false],
    KZ_433: [433.075, 434.775, 10, 100, false],
    KZ_863: [863.0, 868.0, 30, 100, false],
    NP_865: [865.0, 868.0, 30, 100, false],
    BR_902: [902.0, 907.5, 30, 100, false],
    LORA_24: [2400.0, 2483.5, 10, 100, true],
  };

  // preset -> [bandwidth kHz, bandwidth kHz on wide LoRa, spread factor, coding rate].
  // Only presets the firmware implements; the others in the enum fall through to LONG_FAST.
  const PRESETS = {
    LONG_FAST: [250.0, 812.5, 11, 5],
    LONG_MODERATE: [125.0, 406.25, 11, 8],
    LONG_SLOW: [125.0, 406.25, 12, 8],
    LONG_TURBO: [500.0, 1625.0, 11, 8],
    MEDIUM_FAST: [250.0, 812.5, 9, 5],
    MEDIUM_SLOW: [250.0, 812.5, 10, 5],
    SHORT_FAST: [250.0, 812.5, 7, 5],
    SHORT_SLOW: [250.0, 812.5, 8, 5],
    SHORT_TURBO: [500.0, 1625.0, 7, 5],
  };

  const BW_CODES = { false: [31, 62, 125, 250, 500], true: [200, 400, 800, 1600] };
  const BW_KHZ = { 31: 31.25, 62: 62.5, 200: 203.125, 400: 406.25, 800: 812.5, 1600: 1625.0 };
  const SF_CHOICES = [7, 8, 9, 10, 11, 12];
  const CR_CHOICES = [5, 6, 7, 8];
  const HOP_MAX = 7;
  const EPS = 1e-6;

  const limits = (region) => REGIONS[region] || null;
  const bwKhz = (code) => BW_KHZ[code] || Number(code);
  function presetParams(preset, region) {
    const p = PRESETS[preset], l = limits(region);
    return [l && l[4] ? p[1] : p[0], p[2], p[3]];
  }
  function fitsRegion(region, khz) {
    const l = limits(region);
    return !l || (l[1] - l[0]) + EPS >= khz / 1000.0;
  }
  const validPresets = (region) => Object.keys(PRESETS).filter((p) => fitsRegion(region, presetParams(p, region)[0]));
  function validBwCodes(region) {
    const l = limits(region);
    return BW_CODES[!!(l && l[4])].filter((c) => fitsRegion(region, bwKhz(c)));
  }
  function slotCount(region, khz) {
    const l = limits(region);
    return l ? Math.floor(((l[1] - l[0]) + EPS) / (khz / 1000.0)) : 0;
  }
  function slotFreqMhz(region, khz, slot) {
    const l = limits(region);
    return l[0] + khz / 2000.0 + (slot - 1) * (khz / 1000.0);
  }
  const maxPower = (region) => (limits(region) ? limits(region)[2] : 30);
  function effectiveBwKhz(s) {
    return s.use_preset ? presetParams(s.modem_preset, s.region)[0] : bwKhz(parseInt(s.bandwidth, 10));
  }

  // Problems with a requested LoRa config; an empty list means it's fine.
  function validate(s) {
    const problems = [];
    const region = s.region, l = limits(region);
    if (s.use_preset) {
      if (!PRESETS[s.modem_preset]) problems.push('Modem preset ' + s.modem_preset + " isn't implemented by the firmware.");
      else if (!validPresets(region).includes(s.modem_preset)) {
        problems.push('Preset ' + s.modem_preset + ' is wider than the ' + region + ' band: the radio would fall back to LONG_FAST.');
      }
    } else {
      if (!validBwCodes(region).includes(parseInt(s.bandwidth, 10))) problems.push('Bandwidth ' + s.bandwidth + " kHz doesn't fit the " + region + ' band.');
      if (!SF_CHOICES.includes(parseInt(s.spread_factor, 10))) problems.push('Spread factor must be 7-12.');
      if (!CR_CHOICES.includes(parseInt(s.coding_rate, 10))) problems.push('Coding rate must be 4/5 to 4/8.');
    }
    for (const [key, label] of [['override_frequency', 'Override frequency'], ['frequency_offset', 'Frequency offset']]) {
      if (!isFinite(parseFloat(s[key]))) problems.push(label + ' must be a number.');
    }
    const override = parseFloat(s.override_frequency) || 0;
    let bw = null;
    try { bw = effectiveBwKhz(s); } catch (e) { /* reported above */ }
    if (bw && l && !override) {
      const slots = slotCount(region, bw), slot = parseInt(s.channel_num, 10);
      if (!(slot >= 0 && slot <= slots)) problems.push('Frequency slot ' + s.channel_num + ' is outside 0-' + slots + ' for ' + region + ' at ' + bw + ' kHz.');
    }
    const power = parseInt(s.tx_power, 10);
    if (l && !(power >= 0 && power <= l[2])) problems.push('TX power ' + s.tx_power + ' dBm is outside 0-' + l[2] + ' for ' + region + '.');
    const hops = parseInt(s.hop_limit, 10);
    if (!(hops >= 0 && hops <= HOP_MAX)) problems.push('Hop limit must be 0-' + HOP_MAX + '.');
    if (!problems.length && override < 0) problems.push("Override frequency can't be negative.");
    return problems;
  }

  // ── IPv4 ──────────────────────────────────────────────────────────────────
  // The firmware hands the stored fixed32 to Arduino's IPAddress(uint32_t), which keeps
  // the FIRST octet in the LOW byte: 192.168.1.10 is 0x0A01A8C0.
  function parseIp(text, label) {
    const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(text || '');
    const parts = m ? m.slice(1).map(Number) : null;
    if (!parts || parts.some((p) => p > 255)) throw new Error(label + ": '" + (text || '') + "' isn't a valid IPv4 address.");
    return parts;
  }
  const ipToInt = (parts) => ((parts[0]) | (parts[1] << 8) | (parts[2] << 16) | (parts[3] << 24)) >>> 0;
  const ipToNet = (parts) => ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  function intToIp(value) {
    value = (value || 0) >>> 0;
    if (!value) return '';
    return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255].join('.');
  }
  // A dotted mask (255.255.255.0) or prefix (/24 or 24) -> prefix length.
  function parseMask(text) {
    text = (text || '').trim().replace(/^\//, '');
    if (!text) throw new Error('Subnet Mask: enter a subnet mask (e.g. 255.255.255.0).');
    const bad = new Error("Subnet Mask: '" + text + "' isn't a valid subnet mask (use e.g. 255.255.255.0 or /24).");
    if (text.includes('.')) {
      let parts;
      try { parts = parseIp(text, 'Subnet Mask'); } catch (e) { throw bad; }
      const n = ipToNet(parts);
      const inv = (~n) >>> 0;
      if ((inv & (inv + 1)) !== 0) throw bad;         // not contiguous ones then zeros
      let bits = 0;
      for (let i = 31; i >= 0 && (n >>> i) & 1; i--) bits++;
      return bits;
    }
    if (!/^\d+$/.test(text) || +text > 32) throw bad;
    return +text;
  }
  // Check a static IPv4 assignment; returns the fixed32 values the radio stores.
  function validateNetwork(mode, ip, subnet, gateway, dns) {
    const values = { ip: 0, subnet: 0, gateway: 0, dns: 0 };
    if (mode !== 'STATIC') return values;
    const ipParts = parseIp(ip, 'IP Address');
    const prefix = parseMask(subnet);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const addr = ipToNet(ipParts);
    const network = (addr & mask) >>> 0, broadcast = (network | (~mask >>> 0)) >>> 0;
    const shown = ipParts.join('.');
    if (ipParts[0] >= 224 || addr === 0 || ipParts[0] === 127) throw new Error('IP Address: ' + shown + " can't be assigned to a device.");
    if ((addr === network || addr === broadcast) && prefix < 31) {
      throw new Error('IP Address: ' + shown + ' is the network/broadcast address of its subnet. Pick a host address.');
    }
    values.ip = ipToInt(ipParts);
    values.subnet = ipToInt([mask >>> 24, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255]);
    if ((gateway || '').trim()) {
      const g = parseIp(gateway, 'Gateway');
      if (((ipToNet(g) & mask) >>> 0) !== network) throw new Error('Gateway: ' + g.join('.') + " isn't on the device's own subnet.");
      values.gateway = ipToInt(g);
    }
    if ((dns || '').trim()) values.dns = ipToInt(parseIp(dns, 'DNS'));
    return values;
  }

  window.LoRa = { REGIONS, PRESETS, SF_CHOICES, CR_CHOICES, HOP_MAX, limits, bwKhz, presetParams, validPresets,
    validBwCodes, slotCount, slotFreqMhz, maxPower, effectiveBwKhz, validate };
  window.Net = { intToIp, validateNetwork, parseMask };
})();
