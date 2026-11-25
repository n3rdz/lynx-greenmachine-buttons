// Katalog der greenMachine-Parameter: Einordnung in Kategorien, lesbare Namen,
// Auswahllisten fuer Aktionen/Feedbacks und automatisch erzeugte Presets.

'use strict'

const P = require('./protocol')

// Nie anbieten (gefaehrlich oder sinnlos als Taste)
const EXCLUDE = [/^FactoryReset$/, /^Event_.*_SNMP$/, /^displayName$/]

// Reihenfolge = Prioritaet. Erste passende Regel gewinnt.
const CATEGORY_RULES = [
	{ id: 'source', name: 'Quelle & Eingaenge', re: /^(VideoProc\d*\/Source$|UHDSDIIn\/|HDMIIn\/|OutputSourceOptical)/ },
	{ id: 'converter_meta', name: 'Konverter Metadaten', re: /^Conv\d*\/Meta\// },
	{ id: 'converter', name: 'Konverter', re: /^Conv\d*\// },
	{ id: 'test', name: 'Testbild & Freeze', re: /^(Out\d*\/(Test\/|IfNoInput|FreezeMode)|VideoProc\d*\/Sync\/InputFreeze)/ },
	{ id: 'embed', name: 'Audio-Embedding', re: /^(Out\d*\/(Embed|Delete)Group|UHDEmbed\/)/ },
	{ id: 'output', name: 'Ausgang', re: /^(Out\d*\/|UHDSDIOut\/|HDMIOut\/(?!Audio))/ },
	{ id: 'color', name: 'Farbe', re: /^(VideoProc\d*\/(BasicColor|ColorCorrection)|VideoProcUHD\/(Input|Output))/ },
	{ id: 'processor', name: 'Video-Prozessor', re: /^(VideoProc\d*\/|VideoProcUHD\/)/ },
	{ id: 'reference', name: 'Referenz', re: /^(ReferenceSource|RefOut\/|FreqPreselect|InputToRefTolerance)/ },
	{ id: 'system', name: 'System & GPI', re: /^(Locate|Restart|GPI\/)/ },
	{ id: 'audio', name: 'Audio', re: /./ },
]

const CATEGORIES = CATEGORY_RULES.map(({ id, name }) => ({ id, name }))

// Kategorien, fuer die automatisch Tasten (Presets) erzeugt werden
const PRESET_CATEGORIES = ['source', 'converter', 'test', 'output', 'color', 'processor', 'reference', 'system']

const PREFIX_LABELS = [
	[/^VideoProcUHD\//, 'UHD-Prozessor › '],
	[/^VideoProc(\d+)\//, 'Video-Proz. $1 › '],
	[/^UHDSDIIn\//, 'UHD-SDI-Eingang › '],
	[/^UHDSDIOut\//, 'UHD-SDI-Ausgang › '],
	[/^HDMIIn\//, 'HDMI-Eingang › '],
	[/^HDMIOut\//, 'HDMI-Ausgang › '],
	[/^Conv(\d+)\//, 'Konverter $1 › '],
	[/^Out(\d+)\//, 'Ausgang $1 › '],
	[/^RefOut\//, 'Referenz-Ausgang › '],
]

function categoryOf(label) {
	for (const r of CATEGORY_RULES) if (r.re.test(label)) return r.id
	return 'audio'
}

function isExcluded(label) {
	return EXCLUDE.some((re) => re.test(label))
}

/** Lesbarer Name fuer einen Parameter, z. B. "Konverter 1 › Mode". */
function prettyName(label) {
	let out = label
	for (const [re, rep] of PREFIX_LABELS) {
		if (re.test(out)) {
			out = out.replace(re, rep)
			break
		}
	}
	return out.replace(/\//g, ' › ')
}

/** Kurzer Name fuer Tastenbeschriftung: letztes Segment. */
function shortName(label) {
	const parts = label.split('/')
	return parts[parts.length - 1]
}

/**
 * Baut aus einer X-Antwort einen Katalogeintrag.
 * raw = Parametername in Rohform (wie gesendet), info = P.parseExtended(...)
 */
function makeEntry(raw, info, rawValueField) {
	const label = P.unescape(raw)
	const e = {
		raw,
		label,
		type: info.type,
		readOnly: info.readOnly,
		value: info.value,
		category: categoryOf(label),
	}
	if (info.type === 'Selection') {
		// Rohwerte (mit Maskierung) fuers Senden, Labels fuer die Anzeige
		const rawSel = rawSelections(rawValueField)
		e.options = info.selections.map((s) => ({
			raw: rawSel.get(s.index) ?? s.label,
			label: s.label,
			valid: s.valid !== false,
		}))
	} else if (info.type === 'Float') {
		e.min = num(info.fields.MIN)
		e.max = num(info.fields.MAX)
		e.step = num(info.fields.SW) || 1
	}
	return e
}

function num(v) {
	const n = parseFloat(v)
	return Number.isFinite(n) ? n : undefined
}

function rawSelections(valueField) {
	const map = new Map()
	if (!valueField) return map
	for (const part of P.splitUnescaped(valueField, ':')) {
		const m = /^SEL(\d+)__([\s\S]*)$/.exec(part)
		if (m) map.set(Number(m[1]), m[2])
	}
	return map
}

/** Nur das, was man sinnvoll schalten kann. */
function isControllable(e) {
	if (!e || e.readOnly || isExcluded(e.label)) return false
	if (e.type === 'Selection') return e.options && e.options.some((o) => o.valid)
	return e.type === 'Float'
}

const SEP = '\t'
const choiceId = (raw, value) => raw + SEP + value
const splitChoice = (id) => {
	const i = String(id).indexOf(SEP)
	return i < 0 ? [String(id), ''] : [id.slice(0, i), id.slice(i + 1)]
}

function isOnOff(e) {
	if (e.type !== 'Selection' || e.options.length !== 2) return false
	const l = e.options.map((o) => o.label.toLowerCase())
	return l.includes('on') && l.includes('off')
}

function onValue(e) {
	const o = e.options.find((x) => x.label.toLowerCase() === 'on')
	return o ? o.raw : e.options[1].raw
}

/** Auswahlliste "Parameter = Wert" einer Kategorie. */
function settingChoices(entries, categoryId) {
	const out = []
	for (const e of entries) {
		if (e.category !== categoryId || e.type !== 'Selection') continue
		const name = prettyName(e.label)
		for (const o of e.options) {
			if (!o.valid) continue
			out.push({ id: choiceId(e.raw, o.raw), label: `${name} = ${o.label}` })
		}
	}
	return out
}

function selectionParamChoices(entries) {
	return entries
		.filter((e) => e.type === 'Selection')
		.map((e) => ({ id: e.raw, label: `${catName(e.category)}: ${prettyName(e.label)}` }))
}

function floatParamChoices(entries) {
	return entries
		.filter((e) => e.type === 'Float')
		.map((e) => ({
			id: e.raw,
			label: `${catName(e.category)}: ${prettyName(e.label)} (${fmt(e.min)} … ${fmt(e.max)})`,
		}))
}

function fmt(n) {
	return n === undefined ? '?' : String(n)
}

function catName(id) {
	const c = CATEGORIES.find((x) => x.id === id)
	return c ? c.name : id
}

/** Variablen-ID aus einem Parameternamen. */
function varId(label) {
	return 'p_' + label.replace(/[^A-Za-z0-9]+/g, '_').replace(/_+$/, '')
}

module.exports = {
	CATEGORIES,
	PRESET_CATEGORIES,
	categoryOf,
	isExcluded,
	prettyName,
	shortName,
	makeEntry,
	isControllable,
	choiceId,
	splitChoice,
	isOnOff,
	onValue,
	settingChoices,
	selectionParamChoices,
	floatParamChoices,
	catName,
	varId,
}
