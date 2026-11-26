# LYNX greenMachine Modul für Bitfocus Buttons – Installation

Ordner (Beispiel): `D:\Claude\Bitfocus Buttons\lynx-greenmachine` (Version 0.2.1)

**Fertiges Paket von GitHub (Releases):** enthält `node_modules` bereits. Dann Schritt 1 überspringen, kein Node.js nötig.

## 1. Einmal bauen (Node.js nötig)

PowerShell öffnen:

```
cd "D:\Claude\Bitfocus Buttons\lynx-greenmachine"
npm.cmd install
npm.cmd test
```

`npm.cmd` statt `npm` umgeht die gesperrte Skriptausführung. `npm test` meldet „Alle Protokoll-Tests bestanden“.
Nach einem Update der Moduldateien reicht es, Buttons neu zu starten. `npm install` ist nur nötig, wenn `node_modules` fehlt.

## 2. In Buttons einbinden

1. Buttons → Einstellungen → **Configuration data**.
2. Ganz unten bei **Local module paths**: `D:\Claude\Bitfocus Buttons\lynx-greenmachine`
3. Buttons neu starten.

## 3. Verbindung anlegen

1. **Connect → Connection → +Add**, nach „greenMachine“ suchen.
2. IP `10.4.111.102` und Port `2306` prüfen. Benutzer `admin` und Passwort sind schon vorbelegt.
3. Speichern. Status wird grün; die Variable `scan_status` zeigt nach einigen Sekunden „fertig: … schaltbare Parameter“.

## 4. Tasten anlegen

In den **Presets** der Verbindung liegen fertige Tasten, nach Kategorie sortiert:

| Kategorie | Beispiele |
| --- | --- |
| Quelle & Eingänge | Video-Proz. 1 › Source (Opt In 1/2, UHD-SDI In, HDMI In), UHD-SDI-Eingang › SourceNonUHD (SDI In 1–4), Quad Link / Single |
| Konverter | Format (1080i/50 …), Mode (Letterbox, Center Cut, 14:9, Stretch), Bypass, Motion Adaptive, AFD/WSS-Steuerung |
| Testbild & Freeze | Testbild an/aus, Muster, Verhalten ohne Eingang, Freeze |
| Ausgang | Delay, 3G Level A/B, Flip, HDMI-Ausgang (Farbraum, Seitenverhältnis …), UHD-SDI-Ausgang |
| Farbe | Farbkorrektur an/aus, Colorimetry, RGB-Gain/Lift/Gamma (+/−) |
| Referenz | Referenzquelle, Referenz-Ausgang Standard |
| System & GPI | Locate, GPI-Ausgänge |

Taste auf das Stream Deck Studio ziehen. Aktive Werte werden grün.

Audio (Mute, Gain, Routing, MADI, AES, Dolby …) gibt es nicht als Preset, weil es über 2000 Parameter sind. Dafür die Aktionen „Beliebige Auswahl setzen“, „An/Aus umschalten“ und „Zahlenwert setzen“ nutzen – dort ist jeder Parameter auswählbar.

## Fehlersuche

| Anzeige | Bedeutung |
| --- | --- |
| Status „Anmeldung fehlgeschlagen“ | Benutzer oder Passwort falsch |
| Status bleibt „Connecting“ | IP/Port prüfen; `REMOTE_IPADDRESSES_ALLOWED` an der greenMachine prüfen |
| `last_error` zeigt `PARAMETER READ-ONLY` | Parameter ist im aktuellen Zustand gesperrt (hängt von anderen Einstellungen ab) |
| Presets passen nicht zur Maschine | Aktion „Parameter neu einlesen“ oder Verbindung neu speichern |

Das Modul meldet sich alle 60 Sekunden neu an, erkennt Neustarts und Konstellationswechsel und liest dann alles neu ein.

## Katalog aktualisieren (optional)

Der mitgelieferte Katalog (`src/catalog-default.json`) wird nur genutzt, bis die Maschine live ausgelesen ist. Neu erzeugen aus einer frischen Ausgabe des Auslese-Skripts:

```
npm.cmd run catalog -- "D:\Claude\Bitfocus Buttons\Tools\greenmachine-parameter.txt"
```
