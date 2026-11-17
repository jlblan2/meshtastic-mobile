#!/usr/bin/env python3
"""
Build the installation and user guide:

    python tools/make_guide.py

Writes "Meshtastic Mobile Guide.docx" in the project folder, then uses LibreOffice
(if installed) to make the .doc and .pdf copies. Screenshots come from
tools/screens/ (made with tools/shot.html and headless Edge). Needs python-docx.
"""
import os
import subprocess
from datetime import date

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

VERSION = "1.0.1"
ADDRESS = "https://jlblan2.github.io/meshtastic-mobile/"
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
SCREENS = os.path.join(HERE, "screens")
OUT = os.path.join(ROOT, "Meshtastic Mobile Guide.docx")
SOFFICE = r"C:\Program Files\LibreOffice\program\soffice.exe"

NAVY = RGBColor(0x0A, 0x2A, 0x4A)
TEAL = RGBColor(0x0E, 0x7C, 0x72)
GREY = RGBColor(0x55, 0x5F, 0x6B)
FONT = "Arial"

doc = Document()

# ── page and styles ──────────────────────────────────────────────────────────
sec = doc.sections[0]
sec.page_width, sec.page_height = Inches(8.5), Inches(11)
sec.left_margin = sec.right_margin = Inches(1)
sec.top_margin = sec.bottom_margin = Inches(0.9)


def style(name, size, bold=False, color=None, before=0, after=6, keep=False):
    s = doc.styles[name]
    s.font.name = FONT
    s.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    s.font.size = Pt(size)
    s.font.bold = bold
    s.font.italic = False
    if color is not None:
        s.font.color.rgb = color
    pf = s.paragraph_format
    pf.space_before, pf.space_after = Pt(before), Pt(after)
    pf.keep_with_next = keep
    return s


style("Normal", 11, after=6).paragraph_format.line_spacing = 1.12
style("Title", 28, bold=True, color=NAVY, after=4)
style("Subtitle", 14, color=TEAL, after=18)
style("Heading 1", 18, bold=True, color=NAVY, before=18, after=8, keep=True)
style("Heading 2", 14, bold=True, color=TEAL, before=14, after=6, keep=True)
style("Heading 3", 12, bold=True, color=NAVY, before=10, after=4, keep=True)
style("List Bullet", 11, after=3)
style("Caption", 9, color=GREY, after=10)


def para(text="", bold_lead=None, style_name=None, align=None, after=None, italic=False, color=None):
    """A paragraph. bold_lead is put in bold in front of the text."""
    p = doc.add_paragraph(style=style_name)
    if bold_lead:
        p.add_run(bold_lead).bold = True
    r = p.add_run(text)
    r.italic = italic
    if color is not None:
        r.font.color.rgb = color
    if align is not None:
        p.alignment = align
    if after is not None:
        p.paragraph_format.space_after = Pt(after)
    return p


def h1(text):
    return doc.add_heading(text, level=1)


def h2(text):
    return doc.add_heading(text, level=2)


def h3(text):
    return doc.add_heading(text, level=3)


def bullets(items):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        if isinstance(item, tuple):
            p.add_run(item[0]).bold = True
            p.add_run(item[1])
        else:
            p.add_run(item)


def steps(items):
    """Numbered steps, typed out so every list starts again at 1."""
    for i, item in enumerate(items, 1):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent, pf.first_line_indent = Inches(0.35), Inches(-0.3)
        pf.space_after = Pt(4)
        pf.keep_with_next = i < len(items)  # keep a short list of steps on one page
        p.add_run(f"{i}.").bold = True
        p.add_run("\t")
        pf.tab_stops.add_tab_stop(Inches(0.35))
        if isinstance(item, tuple):
            p.add_run(item[0]).bold = True
            p.add_run(item[1])
        else:
            p.add_run(item)


def shade(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def cell_margins(table, top=70, bottom=70, left=110, right=110):
    tbl_pr = table._tbl.tblPr
    mar = OxmlElement("w:tblCellMar")
    for side, val in (("top", top), ("left", left), ("bottom", bottom), ("right", right)):
        el = OxmlElement(f"w:{side}")
        el.set(qn("w:w"), str(val))
        el.set(qn("w:type"), "dxa")
        mar.append(el)
    tbl_pr.append(mar)


def note(text, lead="Note: ", fill="FFF4D6"):
    """A shaded one-cell box for warnings and tips."""
    t = doc.add_table(rows=1, cols=1)
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.style = "Table Grid"
    cell_margins(t, 90, 90, 140, 140)
    c = t.rows[0].cells[0]
    c.width = Inches(6.5)
    shade(c, fill)
    p = c.paragraphs[0]
    p.paragraph_format.space_after = Pt(0)
    p.add_run(lead).bold = True
    p.add_run(text)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def table(headers, rows, widths):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    cell_margins(t)
    for i, text in enumerate(headers):
        c = t.rows[0].cells[i]
        c.width = Inches(widths[i])
        shade(c, "0A2A4A")
        p = c.paragraphs[0]
        p.paragraph_format.space_after = Pt(0)
        r = p.add_run(text)
        r.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
    for n, row in enumerate(rows):
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].width = Inches(widths[i])
            if n % 2:
                shade(cells[i], "F1F5F9")
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            r = p.add_run(text)
            if i == 0:
                r.bold = True
    # repeat the header row on each page
    tr_pr = t.rows[0]._tr.get_or_add_trPr()
    hdr = OxmlElement("w:tblHeader")
    hdr.set(qn("w:val"), "true")
    tr_pr.append(hdr)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def screens(items, width=2.25):
    """Screenshots side by side with captions underneath. items = [(file, caption), ...]"""
    t = doc.add_table(rows=2, cols=len(items))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, (name, caption) in enumerate(items):
        c = t.rows[0].cells[i]
        p = c.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.keep_with_next = True
        p.add_run().add_picture(os.path.join(SCREENS, name + ".jpg"), width=Inches(width))
        cp = t.rows[1].cells[i].paragraphs[0]
        cp.style = doc.styles["Caption"]
        cp.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cp.add_run(caption)
    for row in t.rows:                      # keep picture and caption on one page
        tr_pr = row._tr.get_or_add_trPr()
        cant = OxmlElement("w:cantSplit")
        cant.set(qn("w:val"), "true")
        tr_pr.append(cant)


def page_break():
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def add_field(paragraph, instr):
    run = paragraph.add_run()
    for kind, text in (("begin", None), (None, instr), ("end", None)):
        if kind:
            el = OxmlElement("w:fldChar")
            el.set(qn("w:fldCharType"), kind)
        else:
            el = OxmlElement("w:instrText")
            el.set(qn("xml:space"), "preserve")
            el.text = text
        run._r.append(el)
    return run


# footer: title on the left, page number on the right
fp = sec.footer.paragraphs[0]
fp.paragraph_format.tab_stops.add_tab_stop(Inches(6.5), alignment=2)
r = fp.add_run(f"Meshtastic Mobile {VERSION} \u2013 Installation and User Guide\tPage ")
r.font.size = Pt(9)
r.font.color.rgb = GREY
add_field(fp, "PAGE").font.size = Pt(9)

# ── title page ───────────────────────────────────────────────────────────────
for _ in range(3):
    doc.add_paragraph()
doc.add_paragraph("Meshtastic Mobile", style="Title")
doc.add_paragraph("Installation and User Guide for iPhone and Android", style="Subtitle")
para(f"App version {VERSION}   \u2022   Guide dated {date.today().strftime('%B %d, %Y').replace(' 0', ' ')}", color=GREY)
para("")
para("Meshtastic Mobile is a phone companion to the Meshtastic GUI program for the PC. It connects to a "
     "Meshtastic radio over Bluetooth and lets you send and receive messages, see the other stations (nodes) "
     "the radio has heard, view them on a map, change the radio\u2019s settings, and back up or restore those settings.")
para("The app address is:")
para(ADDRESS, align=WD_ALIGN_PARAGRAPH.CENTER).runs[0].bold = True
para("")
h3("In this guide")
for n, title in enumerate([
    "Before you start",
    "Installing on an Android phone",
    "Installing on an iPhone or iPad",
    "Connecting to your radio the first time",
    "Using the app: Radio, Messages, Nodes, Map",
    "Settings",
    "Backing up and restoring a radio\u2019s settings",
    "The demo radio",
    "Updating the app",
    "Troubleshooting",
    "What is kept on the phone",
    "How the phone app differs from the PC program",
], 1):
    p = doc.add_paragraph()             # plain numbered lines: no bullet in front of the number
    pf = p.paragraph_format
    pf.left_indent, pf.first_line_indent = Inches(0.6), Inches(-0.4)
    pf.space_after = Pt(2)
    pf.tab_stops.add_tab_stop(Inches(0.6))
    p.add_run(f"{n}.\t{title}")
para("")
para("Meshtastic\u00ae is a registered trademark of Meshtastic LLC. This app is independent and is not affiliated "
     "with or endorsed by the Meshtastic project.", italic=True, color=GREY)
page_break()

# ── 1 ────────────────────────────────────────────────────────────────────────
h1("1.  Before you start")
para("Meshtastic Mobile is a web app. There is nothing to buy and nothing to download from an app store for the "
     "app itself: you open its address in a suitable browser, and the browser gives the page permission to talk to "
     "your radio over Bluetooth.")
h3("What you need")
bullets([
    ("A Meshtastic radio ", "that is switched on, has Bluetooth enabled, and is within a few yards of the phone."),
    ("The radio\u2019s Bluetooth pairing PIN. ", "On a radio with a screen, the 6-digit PIN appears on the screen when "
     "the phone asks for it. On a radio without a screen the PIN is 123456 unless it has been changed."),
    ("An internet connection ", "the first time you open the app, and whenever you use the Map. Messages, nodes "
     "and settings work without internet once the app is open."),
    ("The right browser for your phone: ", "see the table below."),
])
table(["Phone", "Browser to use", "Why"], [
    ["Android", "Google Chrome (Microsoft Edge also works)",
     "Chrome on Android can use Bluetooth radios directly. Firefox and Samsung Internet cannot."],
    ["iPhone / iPad", "Bluefy \u2013 Web BLE Browser (free, from the App Store)",
     "Apple does not allow Safari, or Chrome on iPhone, to use Bluetooth radios from a web page. Bluefy is a "
     "browser made for this purpose."],
], [1.2, 2.3, 3.0])
note("Only one program can use a radio\u2019s Bluetooth link at a time. Before connecting, close the official "
     "Meshtastic app, and disconnect the PC program if it is connected to the same radio by Bluetooth.",
     lead="Important: ")

# ── 2 ────────────────────────────────────────────────────────────────────────
h1("2.  Installing on an Android phone")
steps([
    "Make sure Bluetooth is turned on in the phone\u2019s settings.",
    ("Open Chrome ", "and go to  " + ADDRESS),
    ("Read the disclaimer ", "that appears the first time, and tap \u201cI understand and accept\u201d."),
    ("Add it to the Home screen: ", "tap the three-dot menu at the top right of Chrome, then \u201cAdd to Home screen\u201d "
     "(on some phones it is called \u201cInstall app\u201d), and confirm. A Meshtastic Mobile icon appears on the Home "
     "screen and the app then opens full-screen like any other app."),
    ("Allow Bluetooth when asked. ", "The first time you press Connect by Bluetooth, Android may ask to let Chrome "
     "find \u201cNearby devices\u201d (on older Android versions, \u201cLocation\u201d). Choose Allow; Chrome needs "
     "this permission to look for radios."),
])
para("After the first visit the app starts from the Home screen icon even without an internet connection.")

# ── 3 ────────────────────────────────────────────────────────────────────────
h1("3.  Installing on an iPhone or iPad")
steps([
    "Make sure Bluetooth is turned on in Settings \u203a Bluetooth.",
    ("Install Bluefy: ", "open the App Store, search for \u201cBluefy\u201d, and install \u201cBluefy \u2013 Web BLE "
     "Browser\u201d. It is free."),
    ("Open Bluefy ", "and, if iOS asks whether Bluefy may use Bluetooth, tap Allow."),
    ("Type the app address ", "into Bluefy\u2019s address bar:  " + ADDRESS),
    ("Read the disclaimer ", "that appears the first time, and tap \u201cI understand and accept\u201d."),
    ("Save the page as a bookmark ", "in Bluefy so you can return to it without retyping the address."),
])
note("Do not use Safari\u2019s \u201cAdd to Home Screen\u201d for this app. An icon made that way opens the page in "
     "Safari, which cannot use Bluetooth radios, so the Connect button would not work. Always open the app from "
     "inside Bluefy.", lead="iPhone note: ")
para("If you open the app in Safari by mistake, it tells you so on the Radio screen and shows the address to copy "
     "into Bluefy. You can still try the demo radio from Safari.")

# ── 4 ────────────────────────────────────────────────────────────────────────
h1("4.  Connecting to your radio the first time")
steps([
    "Turn the radio on and keep it close to the phone.",
    "Close the official Meshtastic app if it is running.",
    ("Tap Connect by Bluetooth ", "on the Radio screen. The phone shows a list of Meshtastic radios it can see."),
    ("Choose your radio ", "from the list and confirm (Pair or Connect)."),
    ("Enter the pairing PIN ", "when the phone asks for it: the 6-digit number on the radio\u2019s screen, or 123456 on "
     "a radio without a screen. The app shows \u201cWaiting for pairing\u2026\u201d and keeps trying for about a minute "
     "and a half while you do this."),
    ("Wait while the app reads the radio. ", "It shows \u201cReading the radio\u2019s nodes and settings\u2026\u201d. "
     "A radio with a long node list can take a minute over Bluetooth; be patient."),
])
para("When the Radio screen shows \u201cConnected\u201d with the radio\u2019s name, you are ready. The oval at the top "
     "right of every screen shows the radio\u2019s short name in green while connected.")
para("The PIN is only needed the first time. After that the phone remembers the radio, but you still tap Connect by "
     "Bluetooth and pick the radio each time you open the app: a web page is not allowed to connect to a "
     "Bluetooth device on its own.")
screens([("connect", "The Radio screen before connecting"), ("radio", "The Radio screen when connected")])

# ── 5 ────────────────────────────────────────────────────────────────────────
h1("5.  Using the app")
para("The five buttons along the bottom of the screen switch between Radio, Messages, Nodes, Map and Settings.")

h2("Radio")
para("Shows whether a radio is connected and a summary of it: name, node ID, hardware model, firmware version, "
     "role, LoRa region and modem preset, battery, position, how many nodes it knows, and the kind of link.")
bullets([
    ("Connect by Bluetooth ", "starts a connection (section 4)."),
    ("Disconnect ", "releases the radio so another phone or program can use it."),
    ("Try the demo radio ", "opens a pretend radio for practice (section 8)."),
])
para("If the link drops, or the radio restarts after a settings change, a yellow bar appears at the top and the app "
     "tries to reconnect by itself. If it cannot, it returns to the Connect screen.")
para("A yellow bar reading \u201cThis radio has no LoRa region set\u201d means the radio is new or was reset and cannot "
     "transmit until a region is chosen under Settings \u203a LoRa, or a settings backup is restored.")

h2("Messages")
para("The row of ovals at the top lists your conversations: one for each channel on the radio (marked with #), and "
     "one for each person you have exchanged direct messages with. Tap an oval to open that conversation. A red "
     "number shows unread messages, and a red dot appears on the Messages button at the bottom.")
steps([
    "Tap the conversation you want.",
    "Type in the box at the bottom. A message can be up to 200 bytes (about 200 plain characters).",
    "Tap Send.",
])
para("To start a direct message with someone new, go to Nodes, tap the station, and tap \u201cSend a direct message\u201d.")
para("Under each message you send, the app shows what happened to it:")
table(["Status", "Meaning"], [
    ["Sending\u2026", "The radio has the message and is transmitting it."],
    ["Sent", "A channel message went out and was heard by the mesh."],
    ["Delivered", "A direct message was confirmed by the recipient\u2019s radio."],
    ["Sent, not yet confirmed by the recipient", "Another radio relayed your direct message, but the recipient has not confirmed it yet."],
    ["No acknowledgement", "Nothing was heard back within a minute and a half. The message may or may not have arrived."],
    ["Failed: (reason)", "The radio could not deliver it; for example NO_ROUTE or MAX_RETRANSMIT (no radio answered)."],
], [2.4, 4.1])
para("Messages only arrive while the app is open and connected. The radio itself keeps listening when the app is "
     "closed, but this app does not collect what arrived in the meantime.")

h2("Nodes")
para("Lists every station in the radio\u2019s own node list. Your radio is always first, outlined in green. Each row "
     "shows the short name, long name, role and hardware, and on the right when it was last heard, its distance in "
     "miles from your radio (if both have a position), signal strength, or number of hops.")
bullets([
    ("Search ", "narrows the list by name, node ID or hardware."),
    ("The sort box ", "orders the list by last heard, name, distance, signal or hops."),
    ("Tap a station ", "for its details: node ID, hardware, role, last heard, signal (SNR), hops away, channel, "
     "battery, position, distance, and whether it was heard by radio or through MQTT (the internet). From there you "
     "can send it a direct message or show it on the map."),
])
para("The list is exactly what the radio holds. A station that is missing has not been heard by this radio.")
screens([("messages", "Messages"), ("nodes", "Nodes"), ("node", "A station\u2019s details")], width=2.0)

h2("Map")
para("Shows every station that has reported a position, on a street map. Your radio is the orange dot; the others "
     "are teal. Each dot is labelled with the station\u2019s short name. Tap a dot for that station\u2019s details. "
     "Pinch to zoom and drag to move the map.")
para("The map needs an internet connection for its background. The line under the map says how many of the known "
     "stations have reported a position.")
screens([("map", "Map"), ("settings", "Settings")])

# ── 6 ────────────────────────────────────────────────────────────────────────
h1("6.  Settings")
para("The Settings screen is a list of sections. Tap a section to open it, change what you need, then tap that "
     "section\u2019s Save button. The app asks you to confirm, writes the change to the radio, and the radio usually "
     "restarts. The app reconnects by itself; this can take up to a minute over Bluetooth.")
note("Settings are written to the radio itself, not kept in the app. A wrong LoRa setting can take a radio off your "
     "mesh until it is corrected, so change only what you understand, and make a backup first (section 7).",
     lead="Caution: ")

h2("Device")
bullets([
    ("Long name and Short name: ", "how the radio appears to others. The short name is up to 4 characters."),
    ("Role: ", "CLIENT suits almost every radio. ROUTER and REPEATER are only for well-placed fixed stations."),
    ("Bluetooth pairing PIN: ", "the 6-digit PIN used when the radio\u2019s pairing mode is Fixed PIN. After changing "
     "it you must pair the phone again."),
    ("Keep Bluetooth awake (seconds): ", "how long the radio waits for Bluetooth before sleeping. 0 uses the "
     "radio\u2019s own default."),
])

h2("LoRa")
para("These are the radio-frequency settings. Every radio on your mesh must use the same region, modem preset and "
     "frequency slot.")
bullets([
    ("Region: ", "the country or band plan (US for the United States). The line underneath shows the band and power limit."),
    ("Use a modem preset / Modem preset: ", "the standard speed-and-range choices, such as LONG_FAST. Only presets "
     "that fit the chosen region are offered. With the box unticked you set bandwidth, spread factor and coding "
     "rate yourself."),
    ("Hop limit: ", "how many times other radios may relay your messages (0 to 7; 3 is normal)."),
    ("Transmit power: ", "in dBm. 0 uses the radio\u2019s default. The limit for the region is shown underneath."),
    ("Transmit enabled: ", "untick to make the radio listen only. The app asks you to confirm."),
    ("Frequency slot: ", "0 lets the radio pick the slot from the primary channel\u2019s name. The line underneath "
     "shows how many slots the region has and the frequency of the slot you entered."),
    ("Override frequency and Frequency offset: ", "for special cases; leave at 0 normally."),
    ("The remaining tick boxes ", "(duty-cycle override, boosted receive gain, PA fan, MQTT options) match the same "
     "settings in the PC program."),
])
para("If a combination is not valid for the region, the app explains the problem in red and does not save.")

h2("Channels")
para("Lists the channels on the radio. Slot 0 is the primary channel. Tap a channel to edit it, or tap "
     "\u201cAdd a channel\u201d to create a secondary one. Channel changes are saved immediately and do not restart the radio.")
bullets([
    ("Name: ", "up to 11 characters. On the primary channel, leave it empty to use the preset\u2019s standard name."),
    ("Encryption key: ", "None (no encryption); Default (the public Meshtastic key, which anyone can read); Random "
     "(the app makes a new private 256-bit key); or Custom (type or paste a key in base64). Radios must have the "
     "same name and key to share a channel."),
    ("MQTT uplink / downlink: ", "whether this channel\u2019s traffic may go to or come from an MQTT server."),
    ("Position precision: ", "how exactly your position is shared on this channel. 0 does not share it, 32 shares "
     "the exact position, and 13 is roughly a 2-mile area."),
    ("Muted: ", "silences notifications from this channel on the radio."),
    ("Delete channel: ", "available for secondary channels. The channels after it move up one slot."),
])
screens([("settings-lora", "Settings \u203a LoRa"), ("settings-channels", "Settings \u203a Channels")])

h2("Network")
para("WiFi and Ethernet settings, for radios that have that hardware: WiFi on/off, network name (SSID) and "
     "password, Ethernet on/off, and DHCP or a static address (IP address, subnet mask, gateway and DNS). The app "
     "checks a static address for mistakes before saving.")
note("On ESP32-based radios, turning WiFi on turns Bluetooth off. After saving, the phone can no longer reach the "
     "radio by Bluetooth until WiFi is turned off again, from the PC program over USB or from the radio\u2019s own menu.",
     lead="Warning: ")

h2("MQTT")
para("Settings for linking the radio to an MQTT server over the internet: on/off, server address, user name, "
     "password, root topic, encryption, JSON output, TLS, proxy to client, and map reporting.")
para("This app does not relay MQTT traffic itself. On a radio with no WiFi or Ethernet, MQTT only works through "
     "\u201cProxy to client\u201d while the official Meshtastic app or the PC program is the connected client. The app "
     "warns you about this when you save.")

h2("Restart radio, Log and About")
bullets([
    ("Restart radio ", "restarts the radio after a confirmation. The app reconnects by itself."),
    ("Log ", "lists what the app and radio have done recently. If something goes wrong, the lines here are the "
     "most useful thing to pass on when asking for help."),
    ("About ", "shows the app version, opens this guide (it is kept on the phone, so it opens with no signal), and lets you "
     "read the disclaimer again."),
])

# ── 7 ────────────────────────────────────────────────────────────────────────
h1("7.  Backing up and restoring a radio\u2019s settings")
para("Open Settings \u203a Settings backup and restore. A backup holds everything needed to put a radio back the way "
     "it was: owner name, every settings section, all channels and their keys, a fixed position, canned messages "
     "and ringtone. It does not contain the firmware.")
note("A backup contains the radio\u2019s private key, the channel keys, and any WiFi and MQTT passwords. Treat the "
     "file like a password: do not email it or post it where others can read it.", lead="Keep backups private: ")
screens([("settings-settings", "Settings › Settings backup and restore")])   # next to the steps it shows
h3("To make a backup")
steps([
    "Connect to the radio.",
    "Tap \u201cBack up this radio now\u201d.",
    "The phone offers to share or save the file (for example to Files, or to your own cloud storage). The backup "
    "is also added to the \u201cKept on this phone\u201d list.",
])
para("The app also keeps a backup automatically each time you connect and the radio\u2019s settings have changed since "
     "the last time. These appear in the same list, marked \u201con-connect\u201d.")
h3("To restore a backup")
steps([
    "Connect to the radio you want to restore.",
    "Tap Restore next to a backup in the list, or tap \u201cRestore from a backup file\u2026\u201d and choose the file.",
    "Check the summary the app shows (radio name, date, role, region, preset, channels) and confirm.",
    "The app writes every setting, the radio restarts, and the app reconnects. A report lists what was written and "
    "anything that was skipped.",
])
para("If the backup came from a different radio, the app asks whether to keep the connected radio\u2019s own keys "
     "(right when copying settings to a second radio) or to use the backup\u2019s keys (only when replacing a lost or "
     "reset radio).")
para("Backup files are the same format as the PC program\u2019s, so a backup made on the phone can be restored with "
     "the PC program and the other way round.")

# ── 8 ────────────────────────────────────────────────────────────────────────
h1("8.  The demo radio")
para("\u201cTry the demo radio\u201d on the Radio screen connects the app to a pretend radio built into the app, with "
     "made-up stations. Every screen works, including saving settings and sending messages, but nothing is "
     "transmitted and no real radio is touched. Use it to learn the app or to show it to someone. The oval at the "
     "top right reads \u201c(demo)\u201d while it is in use. Tap Disconnect to leave it.")

# ── 9 ────────────────────────────────────────────────────────────────────────
h1("9.  Updating the app")
para("There is nothing to install when the app is improved; the new version is simply at the same address.")
bullets([
    ("Android: ", "open the app while the phone has internet. It fetches the new version in the background; close "
     "the app completely and open it again to start using it."),
    ("iPhone (Bluefy): ", "reload the page while the phone has internet."),
])
para("The version you are running is shown under Settings \u203a About.")

# ── 10 ───────────────────────────────────────────────────────────────────────
h1("10.  Troubleshooting")
table(["What you see", "What to do"], [
    ["\u201cThis browser can\u2019t use Bluetooth radios\u201d",
     "You are in the wrong browser. On Android use Chrome. On iPhone open the same address in Bluefy."],
    ["The Connect by Bluetooth button is grey",
     "Same cause as above: the browser has no Bluetooth support."],
    ["No radios appear in the list",
     "Check that the radio is on and close by, that the phone\u2019s Bluetooth is on, and that the official Meshtastic "
     "app is closed. On Android, check that Chrome is allowed the Nearby devices (or Location) permission."],
    ["The PIN prompt appears and vanishes, or the PIN is refused",
     "Open the phone\u2019s Bluetooth settings, find the radio, and choose Forget This Device (iPhone) or Forget / "
     "Unpair (Android). Then connect again and enter the PIN shown on the radio."],
    ["\u201cCould not finish connecting\u2026\u201d",
     "Another phone or program probably holds the radio. Close the Meshtastic app and disconnect the PC program, "
     "then try again. If it continues, forget the radio in the phone\u2019s Bluetooth settings and pair again."],
    ["Stuck on \u201cReading the radio\u2019s nodes and settings\u2026\u201d",
     "Large node lists take a minute. If nothing changes after two minutes, tap Cancel and connect again, and "
     "enter the pairing PIN if the phone asks."],
    ["\u201cReconnecting\u2026\u201d after saving a setting",
     "Normal: the radio is restarting. Wait up to a minute. If it returns to the Connect screen, tap Connect by "
     "Bluetooth again."],
    ["Cannot connect after turning WiFi on",
     "On ESP32 radios WiFi switches Bluetooth off. Turn WiFi off again from the PC program over USB or from the "
     "radio\u2019s menu."],
    ["A message shows \u201cFailed\u201d or \u201cNo acknowledgement\u201d",
     "No radio answered. Check that the other station is on the same region, preset and channel, and in range."],
    ["The map is blank",
     "The map background needs internet. Stations appear only if they have reported a position."],
    ["\u201cThis radio has no LoRa region set\u201d",
     "Choose the region under Settings \u203a LoRa and save, or restore a settings backup."],
], [2.5, 4.0])

# ── 11 ───────────────────────────────────────────────────────────────────────
h1("11.  What is kept on the phone")
para("Nothing is sent to any server by the app. The following is stored only in the browser on your phone:")
bullets([
    "That you accepted the disclaimer.",
    "Your recent messages for each radio (the newest 400), so conversations are still there next time.",
    "Settings backups, including the keys and passwords they contain.",
])
para("Clearing the browser\u2019s data for the app address (or removing Bluefy on an iPhone) erases all of it. Save "
     "any backup you want to keep as a file first.")

# ── 12 ───────────────────────────────────────────────────────────────────────
h1("12.  How the phone app differs from the PC program")
table(["Feature", "PC program", "Phone app"], [
    ["Connection", "USB, Bluetooth or network", "Bluetooth only"],
    ["Messages, nodes, map", "Yes", "Yes"],
    ["Device, LoRa, channel, network and MQTT settings", "Yes", "Yes"],
    ["Settings backup and restore", "Yes", "Yes (same file format)"],
    ["Firmware update", "Yes, over the USB cable", "No. A phone browser has no access to the radio\u2019s USB port."],
    ["Full firmware backup and restore", "Yes (ESP32 radios)", "No, for the same reason"],
    ["Report tab and printing", "Yes", "No"],
], [2.6, 1.7, 2.2])
para("Use the PC program for firmware updates. Its \u201cFirmware updates and your settings\u201d section explains how "
     "it saves and restores settings around an update.")

doc.core_properties.title = "Meshtastic Mobile \u2013 Installation and User Guide"
doc.core_properties.author = ""
doc.save(OUT)
print("wrote", OUT)

if os.path.exists(SOFFICE):
    for fmt in ("doc:MS Word 97", "pdf"):
        subprocess.run([SOFFICE, "--headless", "--convert-to", fmt, "--outdir", ROOT, OUT],
                       check=True, capture_output=True, timeout=180)
        print("wrote", os.path.splitext(OUT)[0] + "." + fmt.split(":")[0])
