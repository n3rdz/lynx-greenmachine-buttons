## LYNX greenMachine

Steuert eine LYNX greenMachine über das LYNX Remote Control Protocol (TCP-Port 2306). Nach dem Verbinden liest das Modul alle Parameter der Maschine aus (dauert wenige Sekunden) und bietet jeden beschreibbaren Parameter an.

**Einstellungen**
- IP der greenMachine (Standard 10.4.111.102), Port 2306
- Benutzer `admin` oder `ctrl` und Passwort (mit dem Standard-Login vorbelegt)
- Live auslesen: an lassen, dann passt sich das Modul jeder Konstellation an
- Zusätzliche Variablen: Parameternamen mit Komma getrennt, z. B. `Conv1/ControlMode, HDMIOut/AudioType`

**Presets (fertige Tasten)**
Gruppiert nach Kategorie: Quelle & Eingänge, Konverter, Testbild & Freeze, Ausgang, Farbe, Video-Prozessor, Referenz, System & GPI.
- Auswahl-Parameter: eine Taste pro Wert (wird grün, wenn aktiv) plus „durchschalten“
- An/Aus-Parameter: eine Umschalt-Taste (grün = an)
- Zahlenwerte: Tasten für − und + in Schrittweite

**Aktionen**
- Einstellen: <Kategorie> – Parameter und Wert aus einer Liste
- Beliebige Auswahl setzen – jeder Parameter, auch Audio
- An/Aus umschalten
- Nächster / vorheriger Wert
- Zahlenwert setzen / erhöhen / verringern
- Rohbefehl senden
- Parameter neu einlesen

**Feedbacks**
- Aktiv: <Kategorie>
- Parameter hat Wert
- Ist an

**Variablen**
`uptime`, `constellation`, `scan_status`, `last_error` sowie `p_<Parametername>` für alle Parameter, die in Tasten benutzt werden oder fest eingestellt sind, z. B. `p_VideoProc1_Source`, `p_UHDSDIIn_SourceNonUHD`, `p_Conv1_FormatOut`, `p_InputStatusSDI1`.

Factory Reset und Neustart werden nicht als Taste angeboten.
