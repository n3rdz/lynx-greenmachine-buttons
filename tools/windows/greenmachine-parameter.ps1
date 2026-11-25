# greenMachine: alle Parameter von Slot 1 (Verarbeitungsmodul) auslesen
# Aufruf:  powershell -ExecutionPolicy Bypass -File .\greenmachine-parameter.ps1

$ip       = "10.4.111.102"     # <-- IP der greenMachine
$user     = "admin"             # "admin" oder "ctrl"
$password = 'DEINPASSWORT'      # <-- in einfachen Anfuehrungszeichen lassen (wegen $)
$slot     = "1"                 # 1 = Verarbeitungsmodul, 0 = Controller
$outFile  = "$PSScriptRoot\greenmachine-parameter.txt"

$client = New-Object System.Net.Sockets.TcpClient($ip, 2306)
$stream = $client.GetStream()
$enc    = [System.Text.Encoding]::ASCII
$script:buffer = ""

function Send([string]$cmd) {
    $bytes = $enc.GetBytes($cmd + "`n")
    $stream.Write($bytes, 0, $bytes.Length)
}

# Liest so lange, bis $quietMs lang nichts mehr kommt
function Receive([int]$quietMs = 1500) {
    $buf = New-Object byte[] 65536
    $sw  = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $quietMs) {
        if ($stream.DataAvailable) {
            $n = $stream.Read($buf, 0, $buf.Length)
            $script:buffer += $enc.GetString($buf, 0, $n)
            $sw.Restart()
        } else { Start-Sleep -Milliseconds 20 }
    }
    $lines = $script:buffer -split "`n"
    $script:buffer = $lines[-1]                   # unvollstaendige Zeile behalten
    return $lines[0..($lines.Count - 2)] | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ }
}

# 1) Anmelden
Send ";W;;authentication;${user}:${password}"
$auth = Receive 1000
if ($auth -match "PARAMETER INVALID|ERROR") { Write-Host "Anmeldung fehlgeschlagen: $auth" -ForegroundColor Red; exit 1 }

# 2) Parameterliste holen
Send "$slot;L;;?;"
$listReply = (Receive 2000) | Where-Object { $_ -like "$slot;L;;?;*" } | Select-Object -First 1
if (-not $listReply) { Write-Host "Keine Parameterliste erhalten." -ForegroundColor Red; exit 1 }
$raw = $listReply.Substring("$slot;L;;?;".Length) -split ","

# Scope-Regel: ".Gain2" nach "Left.Gain1" wird zu "Left.Gain2"
$names = @(); $scope = ""
foreach ($n in $raw) {
    if ($n.StartsWith(".")) { $names += "$scope$($n.Substring(1))" }
    else {
        $i = $n.IndexOf(".")
        $scope = if ($i -ge 0) { $n.Substring(0, $i) } else { "" }
        $names += $n
    }
}
Write-Host "$($names.Count) Parameter gefunden - lese Details ..."

# 3) Fuer jeden Parameter die erweiterten Eigenschaften (X) mit allen Auswahlwerten holen
$result = @()
foreach ($name in $names) {
    $escaped = $name -replace '([.:;])', '\$1'
    Send "$slot;X;;$escaped;all"
    $result += Receive 300
}

$result | Set-Content -Path $outFile -Encoding UTF8
Write-Host "Fertig: $outFile" -ForegroundColor Green

# Kurzer Blick auf alles, was nach SDI/Eingang aussieht
$result | Select-String -Pattern "SDI|Input|InSel|Source" | ForEach-Object { $_.Line }

$client.Close()
