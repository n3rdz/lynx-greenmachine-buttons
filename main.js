// LYNX greenMachine – Verbindungsmodul fuer Bitfocus Buttons (und Companion)
// Protokoll: LYNX Remote Control Protocol Rev. 1.9, TCP Port 2306
//
// Das Modul kennt alle beschreibbaren Parameter der Maschine. Beim Start nutzt es einen
// mitgelieferten Katalog (src/catalog-default.json) und liest danach die Maschine live aus.

'use strict'

const { InstanceBase, InstanceStatus, TCPHelper, Regex, combineRgb, runEntrypoint } = require('@companion-module/base')
const P = require('./src/protocol')
const C = require('./src/catalog')

let DEFAULT_CATALOG = []
try {
	DEFAULT_CATALOG = require('./src/catalog-default.json')
} catch (e) {
	DEFAULT_CATALOG = []
}

const CLIENT_ID = 'bfb'
const KEEPALIVE_MS = 60 * 1000
const SCAN_WINDOW = 16 // gleichzeitig offene X-Abfragen beim Einlesen
const SCAN_TIMEOUT_MS = 4000

// Diese Parameter werden immer abonniert und als Variablen angeboten (falls vorhanden)
const DEFAULT_VARIABLE_PARAMS = [
	'VideoProc1/Source',
	'VideoProc1/EffectiveSource',
	'VideoProc1/InputStatus',
	'UHDSDIIn/SourceNonUHD',
	'UHDSDIIn/Mode',
	'InputStatusSDI1',
	'InputStatusSDI2',
	'InputStatusSDI3',
	'InputStatusSDI4',
	'InputStatusUHDSDI',
	'InputStatusHDMI',
	'Conv1/FormatOut',
	'Conv1/Mode',
	'Out1/Test/PatternOn',
	'Out1/IfNoInput',
]

const GREEN = combineRgb(0, 160, 60)
const WHITE = combineRgb(255, 255, 255)
const DARK = combineRgb(40, 40, 40)
const BLUE = combineRgb(0, 60, 120)

class GreenMachineInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.socket = null
		this.rxBuffer = ''
		this.keepaliveTimer = null
		this.feedbackTimer = null
		this.varDefTimer = null

		this.setCatalog(DEFAULT_CATALOG.filter(C.isControllable))

		this.values = new Map() // raw -> aktueller Wert (Anzeigeform)
		this.subs = new Map() // raw -> Anzahl Nutzer
		this.subOwners = new Map() // Feedback-/Aktions-ID -> raw
		this.permSubs = new Set() // dauerhaft abonnierte Parameter (Variablen)
		this.pendingWrites = new Map() // "raw\nwert" -> alternativer Wert fuer zweiten Versuch
		this.resetSession()
	}

	resetSession() {
		this.lastUptime = null
		this.constellation = null
		this.authFailed = false
		this.scan = null
	}

	setCatalog(entries) {
		this.catalog = new Map(entries.map((e) => [e.raw, e]))
		this.catalogList = [...this.catalog.values()]
		this.catalogSignature = signature(this.catalogList)
	}

	// ---------------------------------------------------------------- Lebenszyklus

	async init(config) {
		this.config = config
		this.setupPermanentSubscriptions()
		this.updateDefinitions()
		this.connect()
	}

	async destroy() {
		this.disconnect()
		if (this.feedbackTimer) clearTimeout(this.feedbackTimer)
		if (this.varDefTimer) clearTimeout(this.varDefTimer)
	}

	async configUpdated(config) {
		this.config = config
		this.disconnect()
		this.resetSession()
		this.setupPermanentSubscriptions()
		this.defineVariables()
		this.connect()
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Hinweis',
				value:
					'Steuert eine LYNX greenMachine ueber das Remote Control Protocol (TCP 2306). ' +
					'Nach dem Verbinden liest das Modul alle Parameter aus und erzeugt daraus Aktionen, Feedbacks und Presets.',
			},
			{ type: 'textinput', id: 'host', label: 'IP der greenMachine', width: 6, default: '10.4.111.102', regex: Regex.IP },
			{ type: 'number', id: 'port', label: 'Port', width: 3, default: 2306, min: 1, max: 65535 },
			{
				type: 'dropdown',
				id: 'user',
				label: 'Benutzer',
				width: 3,
				default: 'admin',
				allowCustom: true,
				choices: [
					{ id: 'admin', label: 'admin' },
					{ id: 'ctrl', label: 'ctrl' },
				],
			},
			{ type: 'textinput', id: 'password', label: 'Passwort', width: 6, default: '' },
			{ type: 'textinput', id: 'slot', label: 'Adresse des Verarbeitungsmoduls', width: 6, default: '1' },
			{
				type: 'checkbox',
				id: 'liveScan',
				label: 'Beim Verbinden alle Parameter live auslesen',
				width: 6,
				default: true,
			},
			{
				type: 'textinput',
				id: 'extraVars',
				label: 'Zusaetzliche Parameter als Variablen (durch Komma getrennt)',
				width: 12,
				default: '',
			},
		]
	}

	// ---------------------------------------------------------------- Verbindung

	connect() {
		const host = (this.config.host || '').trim()
		if (!host) return this.updateStatus(InstanceStatus.BadConfig, 'IP fehlt')
		if (!this.config.password) return this.updateStatus(InstanceStatus.BadConfig, 'Passwort fehlt')

		this.updateStatus(InstanceStatus.Connecting)
		this.rxBuffer = ''
		this.socket = new TCPHelper(host, Number(this.config.port) || 2306)
		this.socket.on('status_change', (status, message) => {
			if (!this.authFailed) this.updateStatus(status, message)
		})
		this.socket.on('error', (err) => this.log('debug', `Netzwerkfehler: ${err.message}`))
		this.socket.on('connect', () => {
			this.log('info', `Verbunden mit ${host}`)
			this.resetSession()
			this.startSession()
		})
		this.socket.on('end', () => {
			this.log('warn', 'Verbindung getrennt')
			this.stopKeepalive()
			this.stopScan()
		})
		this.socket.on('data', (data) => this.onData(data))
	}

	disconnect() {
		this.stopKeepalive()
		this.stopScan()
		if (this.socket) {
			this.socket.destroy()
			this.socket = null
		}
	}

	send(cmd) {
		if (this.socket && this.socket.isConnected) {
			this.socket.send(cmd + '\n').catch((e) => this.log('debug', `Senden fehlgeschlagen: ${e.message}`))
			return true
		}
		return false
	}

	slot() {
		return (this.config.slot || '1').trim()
	}

	startSession() {
		this.authenticate()
		this.send(';R;;uptime;')
		this.send(`;RS;${CLIENT_ID};DeployedConstellation;`)
		for (const raw of this.subs.keys()) this.send(`${this.slot()};RS;${CLIENT_ID};${raw};`)
		if (this.config.liveScan !== false) this.startScan()
		this.startKeepalive()
	}

	authenticate() {
		this.send(`;W;;authentication;${this.config.user || 'admin'}:${this.config.password}`)
	}

	startKeepalive() {
		this.stopKeepalive()
		this.keepaliveTimer = setInterval(() => {
			this.authenticate()
			this.send(';R;;uptime;')
		}, KEEPALIVE_MS)
	}

	stopKeepalive() {
		if (this.keepaliveTimer) clearInterval(this.keepaliveTimer)
		this.keepaliveTimer = null
	}

	// ---------------------------------------------------------------- Live-Einlesen

	startScan() {
		this.stopScan()
		this.scan = { queue: [], inFlight: new Map(), results: [], total: 0, done: 0 }
		this.setVariableValues({ scan_status: 'lese Parameterliste ...' })
		this.send(`${this.slot()};L;;?;`)
	}

	stopScan() {
		if (this.scan) for (const t of this.scan.inFlight.values()) clearTimeout(t)
		this.scan = null
	}

	handleParamList(value) {
		if (!this.scan) return
		const names = P.parseParamList(value).filter((n) => !C.isExcluded(P.unescape(n)))
		this.scan.queue = names
		this.scan.total = names.length
		this.log('info', `${names.length} Parameter gefunden, lese Details ...`)
		this.pumpScan()
	}

	pumpScan() {
		const s = this.scan
		if (!s) return
		while (s.inFlight.size < SCAN_WINDOW && s.queue.length) {
			const raw = s.queue.shift()
			s.inFlight.set(
				raw,
				setTimeout(() => this.scanItemDone(raw, null), SCAN_TIMEOUT_MS)
			)
			this.send(`${this.slot()};X;;${raw};all`)
		}
		if (s.inFlight.size === 0 && s.queue.length === 0) this.finishScan()
	}

	scanItemDone(raw, entry) {
		const s = this.scan
		if (!s || !s.inFlight.has(raw)) return false
		clearTimeout(s.inFlight.get(raw))
		s.inFlight.delete(raw)
		s.done++
		if (entry) s.results.push(entry)
		if (s.done % 200 === 0) this.setVariableValues({ scan_status: `${s.done} / ${s.total}` })
		this.pumpScan()
		return true
	}

	finishScan() {
		const s = this.scan
		this.scan = null
		const controllable = s.results.filter(C.isControllable)
		for (const e of s.results) this.values.set(e.raw, e.value)
		this.setVariableValues({ scan_status: `fertig: ${controllable.length} schaltbare von ${s.total} Parametern` })
		this.log('info', `Einlesen fertig: ${controllable.length} schaltbare Parameter`)
		if (controllable.length > 0 && signature(controllable) !== this.catalogSignature) {
			this.setCatalog(controllable)
			this.updateDefinitions()
		}
		this.publishAllVariables()
		this.scheduleFeedbackCheck()
	}

	// ---------------------------------------------------------------- Empfang

	onData(data) {
		this.rxBuffer += data.toString('latin1')
		let idx
		while ((idx = this.rxBuffer.indexOf('\n')) >= 0) {
			const line = this.rxBuffer.slice(0, idx).replace(/\r$/, '')
			this.rxBuffer = this.rxBuffer.slice(idx + 1)
			if (line) this.handleLine(line)
		}
	}

	handleLine(line) {
		const msg = P.parseLine(line)
		if (!msg) return
		if (msg.error) return this.handleError(msg)

		if (msg.address === '') {
			if (msg.param === 'uptime' && msg.command === 'R') return this.handleUptime(msg.value)
			if (msg.param === 'DeployedConstellation') return this.handleConstellation(msg)
			return
		}

		if (msg.command === 'L' && msg.param === '?') return this.handleParamList(msg.value)
		if (msg.command === 'X') return this.handleExtended(msg)
		if (msg.command === 'RS' || msg.command === 'R') return this.handleValue(msg.param, msg.value)
		if (msg.command === 'RU') {
			this.log('warn', 'Abos abgelaufen, baue Sitzung neu auf')
			this.startSession()
		}
	}

	handleError(msg) {
		if (msg.param === 'authentication') {
			this.authFailed = true
			this.updateStatus(InstanceStatus.BadConfig, 'Anmeldung fehlgeschlagen (Benutzer/Passwort)')
			this.log('error', 'Anmeldung an der greenMachine fehlgeschlagen')
			return
		}
		if (/NO AUTHENTICATION/.test(msg.error)) {
			this.authenticate()
			return
		}
		if (msg.command === 'X' && this.scanItemDone(msg.param, null)) return
		if (msg.param === 'DeployedConstellation') return
		if (msg.command === 'W') {
			// Zweiter Versuch mit unmaskiertem Wert (z. B. "4\:3" -> "4:3")
			const key = `${msg.param}\n${msg.value}`
			const alt = this.pendingWrites.get(key)
			this.pendingWrites.delete(key)
			if (alt !== undefined && /PARAMETER INVALID/.test(msg.error)) {
				this.send(`${msg.address};W;;${msg.param};${alt}`)
				return
			}
		}
		this.log('warn', `greenMachine meldet: ${msg.raw}`)
		this.setVariableValues({ last_error: `${P.unescape(msg.param)}: ${msg.error}` })
	}

	handleUptime(value) {
		const up = Number(value)
		if (!Number.isFinite(up)) return
		if (this.lastUptime !== null && up < this.lastUptime) {
			this.log('warn', 'greenMachine wurde neu gestartet, baue Sitzung neu auf')
			this.resetSession()
			this.lastUptime = up
			this.startSession()
			return
		}
		this.lastUptime = up
		this.setVariableValues({ uptime: up })
		if (!this.authFailed) this.updateStatus(InstanceStatus.Ok)
	}

	handleConstellation(msg) {
		const prev = this.constellation
		this.constellation = msg.value
		this.setVariableValues({ constellation: P.unescape(msg.value).split(':')[0] })
		if (prev !== null && prev !== msg.value) {
			this.log('info', 'Neue Konstellation erkannt, lese Parameter neu ein')
			for (const raw of this.subs.keys()) this.send(`${this.slot()};RS;${CLIENT_ID};${raw};`)
			this.startScan()
		}
	}

	handleExtended(msg) {
		const info = P.parseExtended(msg.value)
		const entry = C.makeEntry(msg.param, info, msg.value)
		if (this.scanItemDone(msg.param, entry)) return
		this.handleValue(msg.param, info.value, true)
	}

	handleValue(raw, value, alreadyUnescaped = false) {
		const v = alreadyUnescaped ? value : P.unescape(value)
		if (this.values.get(raw) === v) return
		this.values.set(raw, v)
		if (this.isVarParam(raw)) this.setVariableValues({ [C.varId(P.unescape(raw))]: v })
		this.scheduleFeedbackCheck()
	}

	scheduleFeedbackCheck() {
		if (this.feedbackTimer) return
		this.feedbackTimer = setTimeout(() => {
			this.feedbackTimer = null
			this.checkFeedbacks()
		}, 30)
	}

	// ---------------------------------------------------------------- Abos

	setupPermanentSubscriptions() {
		for (const raw of this.permSubs) this.removeSub(raw)
		this.permSubs = new Set()
		const extra = (this.config.extraVars || '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean)
		for (const label of [...DEFAULT_VARIABLE_PARAMS, ...extra]) {
			const raw = rawFromLabel(label)
			if (this.permSubs.has(raw)) continue
			this.permSubs.add(raw)
			this.addSub(raw)
		}
	}

	isVarParam(raw) {
		return this.subs.has(raw)
	}

	addSub(raw) {
		if (!raw) return
		const n = (this.subs.get(raw) || 0) + 1
		this.subs.set(raw, n)
		if (n === 1) {
			this.send(`${this.slot()};RS;${CLIENT_ID};${raw};`)
			this.scheduleVariableDefinitions()
		}
	}

	removeSub(raw) {
		const n = (this.subs.get(raw) || 0) - 1
		if (n > 0) return this.subs.set(raw, n)
		this.subs.delete(raw)
		this.send(`${this.slot()};RK;${CLIENT_ID};${raw};`)
		this.scheduleVariableDefinitions()
	}

	/** Abo fuer eine Aktion/ein Feedback merken (ownerId = deren ID). */
	ownSub(ownerId, raw) {
		this.dropSub(ownerId)
		if (!raw) return
		this.subOwners.set(ownerId, raw)
		this.addSub(raw)
	}

	dropSub(ownerId) {
		const raw = this.subOwners.get(ownerId)
		if (raw === undefined) return
		this.subOwners.delete(ownerId)
		this.removeSub(raw)
	}

	// ---------------------------------------------------------------- Schreiben

	write(raw, valueRaw) {
		const alt = P.unescape(valueRaw)
		if (alt !== valueRaw) this.pendingWrites.set(`${raw}\n${valueRaw}`, alt)
		this.send(`${this.slot()};W;;${raw};${valueRaw}`)
	}

	currentLabel(raw) {
		if (this.values.has(raw)) return this.values.get(raw)
		const e = this.catalog.get(raw)
		return e ? e.value : undefined
	}

	/** Findet den Rohwert einer Auswahl anhand des Anzeigewerts. */
	optionRaw(entry, label) {
		const o = entry.options.find((x) => x.label === label) || entry.options.find((x) => x.raw === label)
		return o ? o.raw : undefined
	}

	toggle(raw) {
		const e = this.catalog.get(raw)
		if (!e || e.type !== 'Selection') return
		if (!C.isOnOff(e)) return this.cycle(raw, 1)
		const cur = (this.currentLabel(raw) || '').toLowerCase()
		const target = e.options.find((o) => o.label.toLowerCase() === (cur === 'on' ? 'off' : 'on'))
		if (target) this.write(raw, target.raw)
	}

	cycle(raw, dir) {
		const e = this.catalog.get(raw)
		if (!e || e.type !== 'Selection') return
		const opts = e.options.filter((o) => o.valid)
		if (!opts.length) return
		const i = opts.findIndex((o) => o.label === this.currentLabel(raw))
		const next = i < 0 ? opts[0] : opts[(i + dir + opts.length) % opts.length]
		this.write(raw, next.raw)
	}

	setFloat(raw, mode, amount) {
		const e = this.catalog.get(raw)
		if (!e || e.type !== 'Float') return
		const step = e.step || 1
		let v = Number(String(amount).replace(',', '.'))
		if (!Number.isFinite(v)) return this.log('warn', `Ungueltige Zahl: ${amount}`)
		if (mode !== 'set') {
			const cur = parseFloat(this.currentLabel(raw))
			if (!Number.isFinite(cur)) return this.log('warn', `Aktueller Wert von ${e.label} unbekannt`)
			v = mode === 'inc' ? cur + v : cur - v
		}
		if (e.min !== undefined) v = Math.max(e.min, v)
		if (e.max !== undefined) v = Math.min(e.max, v)
		const decimals = (String(step).split('.')[1] || '').length
		v = Math.round(v / step) * step
		this.write(raw, v.toFixed(decimals))
	}

	// ---------------------------------------------------------------- Definitionen

	updateDefinitions() {
		const list = this.catalogList
		const selParams = C.selectionParamChoices(list)
		const onOffParams = selParams.filter((c) => C.isOnOff(this.catalog.get(c.id)))
		const floatParams = C.floatParamChoices(list)
		const valueLabels = unionLabels(list)

		const actions = {}
		const feedbacks = {}

		// Je Kategorie (ausser Audio): "Einstellung" (Parameter = Wert) als eine Auswahlliste
		for (const cat of C.CATEGORIES) {
			if (cat.id === 'audio') continue
			const choices = C.settingChoices(list, cat.id)
			if (!choices.length) continue
			actions[`set_${cat.id}`] = {
				name: `Einstellen: ${cat.name}`,
				options: [{ type: 'dropdown', id: 'setting', label: 'Einstellung', default: choices[0].id, choices }],
				callback: async (ev) => {
					const [raw, val] = C.splitChoice(ev.options.setting)
					this.write(raw, val)
				},
			}
			feedbacks[`active_${cat.id}`] = {
				type: 'boolean',
				name: `Aktiv: ${cat.name}`,
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [{ type: 'dropdown', id: 'setting', label: 'Einstellung', default: choices[0].id, choices }],
				callback: (fb) => {
					const [raw, val] = C.splitChoice(fb.options.setting)
					return this.currentLabel(raw) === P.unescape(val)
				},
				subscribe: (fb) => this.ownSub(fb.id, C.splitChoice(fb.options.setting)[0]),
				unsubscribe: (fb) => this.dropSub(fb.id),
			}
		}

		if (selParams.length) {
			actions.set_selection = {
				name: 'Beliebige Auswahl setzen (alle Parameter, auch Audio)',
				options: [
					{ type: 'dropdown', id: 'param', label: 'Parameter', default: selParams[0].id, choices: selParams },
					{
						type: 'dropdown',
						id: 'value',
						label: 'Wert',
						default: valueLabels[0] ? valueLabels[0].id : '',
						choices: valueLabels,
						allowCustom: true,
					},
				],
				callback: async (ev) => {
					const e = this.catalog.get(ev.options.param)
					if (!e) return
					const raw = this.optionRaw(e, ev.options.value)
					if (raw === undefined) return this.log('warn', `"${ev.options.value}" ist fuer ${e.label} nicht erlaubt`)
					this.write(e.raw, raw)
				},
			}
			actions.cycle = {
				name: 'Naechster / vorheriger Wert',
				options: [
					{ type: 'dropdown', id: 'param', label: 'Parameter', default: selParams[0].id, choices: selParams },
					{
						type: 'dropdown',
						id: 'dir',
						label: 'Richtung',
						default: 'next',
						choices: [
							{ id: 'next', label: 'naechster' },
							{ id: 'prev', label: 'vorheriger' },
						],
					},
				],
				callback: async (ev) => this.cycle(ev.options.param, ev.options.dir === 'prev' ? -1 : 1),
				subscribe: (ev) => this.ownSub(ev.id, ev.options.param),
				unsubscribe: (ev) => this.dropSub(ev.id),
			}
			feedbacks.param_value = {
				type: 'boolean',
				name: 'Parameter hat Wert (alle Parameter)',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [
					{ type: 'dropdown', id: 'param', label: 'Parameter', default: selParams[0].id, choices: selParams },
					{
						type: 'dropdown',
						id: 'value',
						label: 'Wert',
						default: valueLabels[0] ? valueLabels[0].id : '',
						choices: valueLabels,
						allowCustom: true,
					},
				],
				callback: (fb) => this.currentLabel(fb.options.param) === fb.options.value,
				subscribe: (fb) => this.ownSub(fb.id, fb.options.param),
				unsubscribe: (fb) => this.dropSub(fb.id),
			}
		}

		if (onOffParams.length) {
			actions.toggle = {
				name: 'An/Aus umschalten',
				options: [{ type: 'dropdown', id: 'param', label: 'Parameter', default: onOffParams[0].id, choices: onOffParams }],
				callback: async (ev) => this.toggle(ev.options.param),
				subscribe: (ev) => this.ownSub(ev.id, ev.options.param),
				unsubscribe: (ev) => this.dropSub(ev.id),
			}
			feedbacks.is_on = {
				type: 'boolean',
				name: 'Ist an',
				defaultStyle: { bgcolor: GREEN, color: WHITE },
				options: [{ type: 'dropdown', id: 'param', label: 'Parameter', default: onOffParams[0].id, choices: onOffParams }],
				callback: (fb) => (this.currentLabel(fb.options.param) || '').toLowerCase() === 'on',
				subscribe: (fb) => this.ownSub(fb.id, fb.options.param),
				unsubscribe: (fb) => this.dropSub(fb.id),
			}
		}

		if (floatParams.length) {
			actions.set_number = {
				name: 'Zahlenwert setzen / erhoehen / verringern',
				options: [
					{ type: 'dropdown', id: 'param', label: 'Parameter', default: floatParams[0].id, choices: floatParams },
					{
						type: 'dropdown',
						id: 'mode',
						label: 'Modus',
						default: 'set',
						choices: [
							{ id: 'set', label: 'setzen auf' },
							{ id: 'inc', label: 'erhoehen um' },
							{ id: 'dec', label: 'verringern um' },
						],
					},
					{ type: 'textinput', id: 'amount', label: 'Wert', default: '0', useVariables: true },
				],
				callback: async (ev, ctx) => {
					const amount = await ctx.parseVariablesInString(String(ev.options.amount))
					this.setFloat(ev.options.param, ev.options.mode, amount)
				},
				subscribe: (ev) => this.ownSub(ev.id, ev.options.param),
				unsubscribe: (ev) => this.dropSub(ev.id),
			}
		}

		actions.send_raw = {
			name: 'Rohbefehl senden',
			options: [{ type: 'textinput', id: 'cmd', label: 'Befehl (ohne Zeilenende)', default: '' }],
			callback: async (ev) => this.send(ev.options.cmd),
		}
		actions.rescan = {
			name: 'Parameter neu einlesen',
			options: [],
			callback: async () => this.startScan(),
		}

		this.setActionDefinitions(actions)
		this.setFeedbackDefinitions(feedbacks)
		this.defineVariables()
		this.setPresetDefinitions(this.buildPresets())
	}

	scheduleVariableDefinitions() {
		if (this.varDefTimer) return
		this.varDefTimer = setTimeout(() => {
			this.varDefTimer = null
			this.defineVariables()
			this.publishAllVariables()
		}, 200)
	}

	defineVariables() {
		const defs = [
			{ variableId: 'uptime', name: 'Laufzeit der greenMachine (s)' },
			{ variableId: 'constellation', name: 'Aktive Konstellation' },
			{ variableId: 'scan_status', name: 'Status Einlesen' },
			{ variableId: 'last_error', name: 'Letzte Fehlermeldung' },
		]
		for (const raw of this.subs.keys()) {
			const label = P.unescape(raw)
			defs.push({ variableId: C.varId(label), name: C.prettyName(label) })
		}
		this.setVariableDefinitions(defs)
	}

	publishAllVariables() {
		const vals = {}
		for (const raw of this.subs.keys()) {
			const v = this.currentLabel(raw)
			if (v !== undefined) vals[C.varId(P.unescape(raw))] = v
		}
		this.setVariableValues(vals)
	}

	buildPresets() {
		const presets = {}
		let n = 0
		const add = (p) => (presets[`p${n++}`] = { type: 'button', ...p })

		for (const e of this.catalogList) {
			if (!C.PRESET_CATEGORIES.includes(e.category)) continue
			if (/^Restart$/.test(e.label)) continue
			const pretty = C.prettyName(e.label)
			const group = `${C.catName(e.category)}: ${pretty}`
			const short = C.shortName(e.label)

			if (e.type === 'Selection' && C.isOnOff(e)) {
				add({
					category: `${C.catName(e.category)}: An/Aus`,
					name: pretty,
					style: { text: short, size: 'auto', color: WHITE, bgcolor: DARK },
					steps: [{ down: [{ actionId: 'toggle', options: { param: e.raw } }], up: [] }],
					feedbacks: [{ feedbackId: 'is_on', options: { param: e.raw }, style: { bgcolor: GREEN, color: WHITE } }],
				})
			} else if (e.type === 'Selection') {
				const opts = e.options.filter((o) => o.valid)
				if (opts.length > 40) continue
				for (const o of opts) {
					const choice = C.choiceId(e.raw, o.raw)
					add({
						category: group,
						name: `${pretty} = ${o.label}`,
						style: { text: o.label, size: 'auto', color: WHITE, bgcolor: DARK },
						steps: [{ down: [{ actionId: `set_${e.category}`, options: { setting: choice } }], up: [] }],
						feedbacks: [
							{ feedbackId: `active_${e.category}`, options: { setting: choice }, style: { bgcolor: GREEN, color: WHITE } },
						],
					})
				}
				add({
					category: group,
					name: `${pretty}: durchschalten`,
					style: { text: `${short}\\n>>`, size: 'auto', color: WHITE, bgcolor: BLUE },
					steps: [{ down: [{ actionId: 'cycle', options: { param: e.raw, dir: 'next' } }], up: [] }],
					feedbacks: [],
				})
			} else if (e.type === 'Float') {
				for (const [mode, sign] of [
					['dec', '-'],
					['inc', '+'],
				]) {
					add({
						category: group,
						name: `${pretty} ${sign}${e.step}`,
						style: { text: `${short}\\n${sign}${e.step}`, size: 'auto', color: WHITE, bgcolor: BLUE },
						steps: [
							{ down: [{ actionId: 'set_number', options: { param: e.raw, mode, amount: String(e.step) } }], up: [] },
						],
						feedbacks: [],
					})
				}
			}
		}
		return presets
	}
}

function signature(entries) {
	return entries
		.map((e) => `${e.raw}|${e.type}|${(e.options || []).map((o) => o.raw + (o.valid ? '' : '!')).join(',')}`)
		.sort()
		.join('\n')
}

function unionLabels(entries) {
	const s = new Set()
	for (const e of entries) if (e.type === 'Selection') for (const o of e.options) s.add(o.label)
	return [...s].sort((a, b) => a.localeCompare(b, 'de', { numeric: true })).map((l) => ({ id: l, label: l }))
}

/** Aus einem lesbaren Namen die Rohform machen (Doppelpunkte/Semikolons maskieren). */
function rawFromLabel(label) {
	if (/\\/.test(label)) return label // schon maskiert
	return label.replace(/([:;])/g, '\\$1')
}

runEntrypoint(GreenMachineInstance, [])
