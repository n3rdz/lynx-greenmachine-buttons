// Erzeugt src/catalog-default.json aus der Ausgabe von greenmachine-parameter.ps1.
// Aufruf: node tools/build-catalog.js "<Pfad>\greenmachine-parameter.txt"
// Der mitgelieferte Katalog wird nur genutzt, bis das Modul die Maschine live ausgelesen hat.

'use strict'
const fs = require('fs')
const path = require('path')
const P = require('../src/protocol')
const C = require('../src/catalog')

const src = process.argv[2]
if (!src) {
	console.error('Bitte Pfad zur greenmachine-parameter.txt angeben')
	process.exit(1)
}

const text = fs.readFileSync(src, 'utf8').replace(/^﻿/, '')
const entries = []
for (const line of text.split(/\r?\n/)) {
	const msg = P.parseLine(line)
	if (!msg || msg.command !== 'X' || msg.error) continue
	const e = C.makeEntry(msg.param, P.parseExtended(msg.value), msg.value)
	if (C.isControllable(e)) entries.push(e)
}

const out = path.join(__dirname, '..', 'src', 'catalog-default.json')
fs.writeFileSync(out, JSON.stringify(entries))
const byCat = {}
for (const e of entries) byCat[e.category] = (byCat[e.category] || 0) + 1
console.log(`${entries.length} schaltbare Parameter -> ${out}`)
console.log(byCat)
