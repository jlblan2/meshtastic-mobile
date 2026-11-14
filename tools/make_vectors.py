#!/usr/bin/env python3
"""
Write ../tests/vectors.js: messages encoded by the real protobuf library, with
their JSON form, so tests.html can prove proto.js reads and writes the same bytes.

    python tools/make_vectors.py
"""
import json
import os

from google.protobuf import json_format
from meshtastic.protobuf import admin_pb2, channel_pb2, config_pb2, mesh_pb2, telemetry_pb2

V = []
LORA = config_pb2.Config.LoRaConfig


def add(msg):
    V.append({"type": msg.DESCRIPTOR.full_name, "hex": msg.SerializeToString().hex(),
              "json": json_format.MessageToDict(msg, preserving_proto_field_name=True)})


m = mesh_pb2.ToRadio(); m.want_config_id = 4123456789; add(m)
m = mesh_pb2.ToRadio(); m.heartbeat.CopyFrom(mesh_pb2.Heartbeat()); add(m)
m = mesh_pb2.ToRadio(); m.disconnect = True; add(m)

m = mesh_pb2.FromRadio(); m.id = 7
m.my_info.my_node_num = 0xF7C3A2B1; m.my_info.reboot_count = 12; m.my_info.pio_env = "thinknode_m7"
m.my_info.device_id = bytes(range(16)); m.my_info.nodedb_count = 122; add(m)

m = mesh_pb2.FromRadio(); n = m.node_info
n.num = 0x15DF5504; n.user.id = "!15df5504"; n.user.long_name = "Café ⚓ Station"; n.user.short_name = "CF1"
n.user.macaddr = b"\x01\x02\x03\x04\x05\x06"; n.user.hw_model = mesh_pb2.HardwareModel.TRACKER_T1000_E
n.user.role = config_pb2.Config.DeviceConfig.Role.TRACKER; n.user.public_key = bytes(range(32)); n.user.is_unmessagable = False
n.position.latitude_i = 279506543; n.position.longitude_i = -824567891; n.position.altitude = -3
n.position.time = 1794000000; n.position.altitude_hae = -12; n.position.ground_speed = 0; n.position.precision_bits = 32
n.snr = -7.25; n.last_heard = 1794000123; n.hops_away = 0; n.via_mqtt = True
n.device_metrics.battery_level = 101; n.device_metrics.voltage = 4.134; n.device_metrics.channel_utilization = 12.56
n.device_metrics.air_util_tx = 0.0; n.device_metrics.uptime_seconds = 987654; add(m)

m = mesh_pb2.FromRadio(); lo = m.config.lora
lo.use_preset = True; lo.modem_preset = LORA.ModemPreset.MEDIUM_FAST
lo.region = LORA.RegionCode.US; lo.hop_limit = 3; lo.tx_enabled = True; lo.tx_power = 30
lo.channel_num = 45; lo.frequency_offset = -0.0125; lo.override_frequency = 906.875; lo.sx126x_rx_boosted_gain = True
lo.ignore_incoming.extend([1, 300, 0xFFFFFFFF]); lo.config_ok_to_mqtt = True; add(m)

m = mesh_pb2.FromRadio(); p = m.config.power
p.wait_bluetooth_secs = 60; p.sds_secs = 4294967295; p.adc_multiplier_override = 2.1
p.powermon_enables = 18446744073709551615; add(m)

m = mesh_pb2.FromRadio(); s = m.config.security
s.public_key = bytes(range(32)); s.private_key = bytes(range(32, 64)); s.admin_key.append(b"\xaa" * 32); s.admin_key.append(b"\xbb" * 32)
s.serial_enabled = True; add(m)

m = mesh_pb2.FromRadio(); n = m.config.network
n.wifi_enabled = True; n.wifi_ssid = "Dock WiFi"; n.wifi_psk = "p@ss word"; n.ntp_server = "pool.ntp.org"
n.address_mode = config_pb2.Config.NetworkConfig.AddressMode.STATIC
n.ipv4_config.ip = 0x0A01A8C0; n.ipv4_config.subnet = 0x00FFFFFF; n.ipv4_config.gateway = 0x0101A8C0; n.ipv4_config.dns = 0x08080808; add(m)

m = mesh_pb2.FromRadio(); q = m.moduleConfig.mqtt
q.enabled = True; q.address = "mqtt.example.org"; q.username = "u"; q.password = "p"; q.encryption_enabled = True
q.root = "msh/US/FL"; q.proxy_to_client_enabled = True; q.map_reporting_enabled = True
q.map_report_settings.publish_interval_secs = 3600; q.map_report_settings.position_precision = 14; add(m)

m = mesh_pb2.FromRadio(); c = m.channel
c.index = 1; c.role = channel_pb2.Channel.Role.SECONDARY; c.settings.name = "Flotilla"; c.settings.psk = bytes(range(100, 132))
c.settings.uplink_enabled = True; c.settings.module_settings.position_precision = 13; c.settings.module_settings.is_muted = True; add(m)

m = mesh_pb2.FromRadio(); m.config_complete_id = 4123456789; add(m)
m = mesh_pb2.FromRadio(); m.queueStatus.res = -3; m.queueStatus.free = 15; m.queueStatus.maxlen = 16; m.queueStatus.mesh_packet_id = 99; add(m)
m = mesh_pb2.FromRadio(); m.metadata.firmware_version = "2.7.26.abc"; m.metadata.hasWifi = True; m.metadata.hasBluetooth = True
m.metadata.hw_model = mesh_pb2.HardwareModel.HELTEC_V3; m.metadata.hasPKC = True; add(m)

m = mesh_pb2.FromRadio(); k = m.packet
setattr(k, "from", 0x15DF5504); k.to = 0xFFFFFFFF; k.channel = 2; k.id = 0xDEADBEEF; k.rx_time = 1794000500; k.rx_snr = 5.75
k.hop_limit = 2; k.want_ack = True; k.rx_rssi = -97; k.hop_start = 3; k.priority = mesh_pb2.MeshPacket.Priority.RELIABLE
k.decoded.portnum = 1; k.decoded.payload = "Hello ⚓ mesh".encode(); k.decoded.request_id = 0x12345678
k.decoded.bitfield = 1; add(m)

m = mesh_pb2.Routing(); m.error_reason = mesh_pb2.Routing.Error.NONE; add(m)
m = mesh_pb2.Routing(); m.error_reason = mesh_pb2.Routing.Error.MAX_RETRANSMIT; add(m)
m = mesh_pb2.Routing(); m.route_reply.route.extend([0x11111111, 0xFFFFFFFE]); m.route_reply.snr_towards.extend([-12, 40, -128]); add(m)

m = mesh_pb2.Position(); m.latitude_i = -338688000; m.longitude_i = 1512093000; m.altitude = 58; m.sats_in_view = 9
m.altitude_geoidal_separation = -30; add(m)

m = telemetry_pb2.Telemetry(); m.time = 1794000900; d = m.device_metrics
d.battery_level = 55; d.voltage = 3.801; d.channel_utilization = 3.25; d.air_util_tx = 0.875; d.uptime_seconds = 3600; add(m)
m = telemetry_pb2.Telemetry(); m.environment_metrics.temperature = -4.5; m.environment_metrics.relative_humidity = 81.5
m.environment_metrics.barometric_pressure = 1013.25; add(m)

m = admin_pb2.AdminMessage(); m.session_passkey = b"\x01\x02\x03\x04\x05\x06\x07\x08"; m.begin_edit_settings = True; add(m)
m = admin_pb2.AdminMessage(); m.commit_edit_settings = True; add(m)
m = admin_pb2.AdminMessage(); m.get_config_request = admin_pb2.AdminMessage.ConfigType.SESSIONKEY_CONFIG; add(m)
m = admin_pb2.AdminMessage(); m.get_config_request = admin_pb2.AdminMessage.ConfigType.DEVICE_CONFIG; add(m)
m = admin_pb2.AdminMessage(); m.set_owner.long_name = "Base Station"; m.set_owner.short_name = "BASE"; m.set_owner.is_licensed = False
m.set_owner.is_unmessagable = True; add(m)
m = admin_pb2.AdminMessage(); m.session_passkey = b"\x09" * 8
m.set_config.lora.use_preset = True; m.set_config.lora.region = LORA.RegionCode.EU_868
m.set_config.lora.tx_power = 27; m.set_config.lora.hop_limit = 5; add(m)
m = admin_pb2.AdminMessage(); m.set_config.bluetooth.enabled = True
m.set_config.bluetooth.mode = config_pb2.Config.BluetoothConfig.PairingMode.FIXED_PIN; m.set_config.bluetooth.fixed_pin = 654321; add(m)
m = admin_pb2.AdminMessage(); m.set_module_config.mqtt.enabled = False; m.set_module_config.mqtt.address = "x"; add(m)
m = admin_pb2.AdminMessage(); m.set_channel.index = 3; m.set_channel.role = channel_pb2.Channel.Role.SECONDARY
m.set_channel.settings.psk = b"\x01"; m.set_channel.settings.name = "Ops"; add(m)
m = admin_pb2.AdminMessage(); m.set_channel.index = 0; m.set_channel.role = channel_pb2.Channel.Role.DISABLED; add(m)
m = admin_pb2.AdminMessage(); m.set_fixed_position.latitude_i = 279500000; m.set_fixed_position.longitude_i = -825400000
m.set_fixed_position.altitude = 6; add(m)
m = admin_pb2.AdminMessage(); m.set_canned_message_module_messages = "Yes|No|On my way"; add(m)
m = admin_pb2.AdminMessage(); m.get_canned_message_module_messages_request = True; add(m)
m = admin_pb2.AdminMessage(); m.reboot_seconds = 5; add(m)
m = admin_pb2.AdminMessage(); m.reboot_seconds = -1; add(m)
m = admin_pb2.AdminMessage(); m.set_time_only = 1794001000; add(m)

out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests")
os.makedirs(out_dir, exist_ok=True)
out = os.path.join(out_dir, "vectors.js")
with open(out, "w", encoding="utf-8", newline="\n") as fh:
    fh.write("// Generated by tools/make_vectors.py. Do not edit.\nwindow.VECTORS=" + json.dumps(V, separators=(",", ":")) + ";\n")
print(len(V), "vectors ->", os.path.normpath(out))
