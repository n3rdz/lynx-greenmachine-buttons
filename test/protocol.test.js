'use strict'
const assert = require('assert')
const P = require('../src/protocol')

// Scope-Regel aus der Doku
assert.deepStrictEqual(P.parseParamList('Left.Gain1,.Gain2,Right.Gain1,.Gain2'), [
	'Left.Gain1',
	'Left.Gain2',
	'Right.Gain1',
	'Right.Gain2',
])

// X-Antwort "all" aus der Doku
const x = P.parseExtended(
	'TY__Selection:RO__0:EN__1:VAL__Surround:SZ__3:SEL0__Not embedded:IV0__1:SEL1__Stereo:IV1__1:SEL2__Surround:IV2__1'
)
assert.strictEqual(x.type, 'Selection')
assert.strictEqual(x.value, 'Surround')
assert.deepStrictEqual(
	x.selections.map((s) => s.label),
	['Not embedded', 'Stereo', 'Surround']
)

// Zeile mit Fehler
const e = P.parseLine(';W;;authentication;ctrl:lynx$ctrl;PARAMETER INVALID')
assert.strictEqual(e.param, 'authentication')
assert.strictEqual(e.error, 'PARAMETER INVALID')

// Maskierte Zeichen bleiben in Rohform
const m = P.parseLine('DAMP\\.1;R;;Gain\\;x;5')
assert.strictEqual(m.address, 'DAMP\\.1')
assert.strictEqual(m.param, 'Gain\\;x')

// Bewertung: SDI-Auswahl schlaegt Audio-Auswahl
const sdi = P.parseExtended('TY__Selection:RO__0:EN__1:VAL__SDI 1:SZ__2:SEL0__SDI 1:IV0__1:SEL1__SDI 2:IV1__1')
assert.ok(P.scoreInputCandidate('InputSelect', sdi) > P.scoreInputCandidate('HDMIOut/AudioType', x))

console.log('Alle Protokoll-Tests bestanden')
