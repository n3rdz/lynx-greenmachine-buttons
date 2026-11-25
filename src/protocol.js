// LYNX Remote Control Protocol (greenMachine, Rev. 1.9) – reine Text-Hilfsfunktionen.
// Keine Abhaengigkeit von Companion/Buttons, damit sie einzeln testbar sind.

'use strict'

/**
 * Teilt einen String an einem Trennzeichen, das nicht mit Backslash maskiert ist.
 * Die Backslashes bleiben erhalten (Rohform), damit Namen unveraendert zurueckgesendet werden koennen.
 */
function splitUnescaped(str, sep) {
	const parts = []
	let cur = ''
	for (let i = 0; i < str.length; i++) {
		const c = str[i]
		if (c === '\\' && i + 1 < str.length) {
			cur += c + str[i + 1]
			i++
		} else if (c === sep) {
			parts.push(cur)
			cur = ''
		} else {
			cur += c
		}
	}
	parts.push(cur)
	return parts
}

/** Entfernt Maskierungs-Backslashes (Anzeigeform). */
function unescape(str) {
	return str.replace(/\\(.)/g, '$1')
}

/** Maskiert Sonderzeichen des Protokolls in einem Wert (fuer Parameternamen, die wir selbst bauen). */
function escapeName(str) {
	return str.replace(/([.:;\\])/g, '\\$1')
}

/**
 * Zerlegt eine Antwortzeile.
 * Format: <Address>;<Command>;<ClientID>;<ParameterName>;<ParameterValue>[;<Fehler>]
 */
function parseLine(line) {
	const f = splitUnescaped(line, ';')
	if (f.length < 4) return null
	const msg = {
		address: f[0],
		command: f[1],
		clientId: f[2],
		param: f[3],
		value: f.length > 4 ? f[4] : '',
		error: null,
		raw: line,
	}
	if (f.length > 5) {
		msg.error = f.slice(5).join(';')
	} else if (/^(SYNTAX ERROR|DEVICE NOT AVAILABLE|PARAMETER NOT FOUND|PARAMETER INVALID|PARAMETER READ-ONLY|NO AUTHENTICATION)/.test(msg.value) && msg.command !== 'R') {
		// Sicherheitsnetz, falls ein Fehler ohne 5. Feld kommt
		msg.error = msg.value
	}
	return msg
}

/**
 * Wandelt die Antwort von "<slot>;L;;?;" in eine Liste von Parameternamen (Rohform).
 * Beruecksichtigt die Scope-Regel: "Left.Gain1,.Gain2" -> "Left.Gain1","Left.Gain2".
 */
function parseParamList(value) {
	const names = []
	let scope = ''
	for (const tok of splitUnescaped(value, ',')) {
		if (!tok) continue
		if (tok.startsWith('.')) {
			names.push(scope ? `${scope}.${tok.slice(1)}` : tok.slice(1))
		} else {
			const parts = splitUnescaped(tok, '.')
			scope = parts.length > 1 ? parts[0] : ''
			names.push(tok)
		}
	}
	return names
}

/**
 * Zerlegt eine X-Antwort ("TY__Selection:RO__0:EN__1:VAL__SDI 1:SZ__2:SEL0__SDI 1:IV0__1:...").
 * Liefert { type, readOnly, enabled, value, selections:[{index,label,valid}], ... }.
 */
function parseExtended(value) {
	const info = { type: null, readOnly: false, enabled: true, value: '', selections: [], fields: {} }
	const sel = new Map()
	for (const part of splitUnescaped(value, ':')) {
		const m = /^([A-Z]+)(\d*)__([\s\S]*)$/.exec(part)
		if (!m) continue
		const [, key, idx, rawVal] = m
		const val = unescape(rawVal)
		switch (key) {
			case 'TY':
				info.type = val
				break
			case 'RO':
				info.readOnly = val === '1'
				break
			case 'EN':
				info.enabled = val !== '0'
				break
			case 'VAL':
				info.value = val
				break
			case 'SEL': {
				const i = Number(idx)
				sel.set(i, { ...(sel.get(i) || { valid: true }), index: i, label: val })
				break
			}
			case 'IV': {
				const i = Number(idx)
				sel.set(i, { ...(sel.get(i) || { index: i }), valid: val === '1' })
				break
			}
			default:
				info.fields[key + idx] = val
		}
	}
	info.selections = [...sel.values()].filter((s) => s.label !== undefined).sort((a, b) => a.index - b.index)
	// Laut Doku steht bei "all"-Antworten teils "TY__Float", obwohl SEL-Felder folgen
	if (info.selections.length > 0 && info.type !== 'MultiSelection') info.type = 'Selection'
	return info
}

/** Grobe Einschaetzung, ob ein Parameter eine SDI-Eingangswahl ist. Hoeher = wahrscheinlicher. */
function scoreInputCandidate(name, info) {
	if (!info || info.type !== 'Selection' || info.readOnly) return 0
	const n = unescape(name).toLowerCase()
	const labels = info.selections.map((s) => s.label.toLowerCase())
	let score = 1
	if (labels.some((l) => l.includes('sdi'))) score += 5
	if (/sdi/.test(n)) score += 3
	if (/(insel|input.?sel|inselect|source|input)/.test(n)) score += 2
	if (/(audio|aud|embed)/.test(n)) score -= 3
	if (/out/.test(n) && !/in/.test(n)) score -= 2
	return Math.max(score, 0)
}

/** Vorfilter auf Namensebene, damit wir nicht jeden Parameter einzeln abfragen muessen. */
function looksLikeInputName(name) {
	return /(sdi|input|insel|source|src)/i.test(unescape(name))
}

module.exports = {
	splitUnescaped,
	unescape,
	escapeName,
	parseLine,
	parseParamList,
	parseExtended,
	scoreInputCandidate,
	looksLikeInputName,
}
