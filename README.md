# LYNX greenMachine – Modul für Bitfocus Buttons

Verbindungsmodul für [Bitfocus Buttons](https://bitfocus.io/buttons) (läuft auch in Companion), das eine LYNX Technik greenMachine über das LYNX Remote Control Protocol (TCP 2306) steuert.

- Liest beim Verbinden alle Parameter der Maschine aus und bietet jeden beschreibbaren Parameter an
- Fertige Tasten (Presets) für Quelle, SDI-/UHD-Eingang, Konverter, Testbild, Ausgang, Farbe, Referenz, GPI
- Grüne Rückmeldung für aktive Werte, Variablen für Quelle, Format und Signalstatus
- Audio (Mute, Gain, Routing, MADI, AES, Dolby) über generische Aktionen
- Automatische Anmeldung, Keepalive, Erkennung von Neustart und Konstellationswechsel

## Installation

**Fertiges Paket:** Unter *Releases* die ZIP-Datei laden, entpacken, den Ordner `lynx-greenmachine` in Buttons unter *Configuration data → Local module paths* eintragen und Buttons neu starten. Node.js ist dafür nicht nötig.

**Aus dem Quellcode:** Repo klonen, `npm install` (unter Windows `npm.cmd install`), dann wie oben.

Details: [INSTALLATION.md](INSTALLATION.md) · Hilfe im Modul: [companion/HELP.md](companion/HELP.md)

## Werkzeuge

- `tools/windows/greenmachine-parameter.ps1` – liest alle Parameter einer greenMachine in eine Textdatei
- `npm run catalog -- <datei>` – erzeugt daraus den mitgelieferten Katalog `src/catalog-default.json`
