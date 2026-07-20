const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
const now = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

export class HilBridge extends EventTarget {
  constructor(options = {}) {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false;
    this.synthetic = false;
    this.benchSafe = true;
    this.emergencyStopped = false;
    this.sequence = 0;
    this.lastTransmit = 0;
    this.lastTelemetry = null;
    this.lastActuators = null;
    this.protocol = options.protocol || 'vidyut.hil.v1';
    this.watchdogMs = Math.max(250, Number(options.watchdogMs) || 750);
    this.handshakeTimeoutMs = Math.max(500, Number(options.handshakeTimeoutMs) || 3000);
    this.handshake = { acknowledged: false, controller: null, firmware: null, receivedAt: null };
    this.integrity = { sent: 0, received: 0, malformed: 0, rejected: 0, saturated: 0, droppedSequences: 0, outOfOrder: 0, watchdogTrips: 0 };
    this.lastReceiveAt = 0;
    this.lastCommandAt = 0;
    this.lastResponseSequence = null;
    this.sessionActive = false;
    this.watchdogTimer = null;
  }

  get available() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  get ready() {
    return this.connected && (this.synthetic || this.handshake.acknowledged) && !this.emergencyStopped;
  }

  status(detail = '') {
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: this.connected, ready: this.ready, synthetic: this.synthetic, benchSafe: this.benchSafe, emergencyStopped: this.emergencyStopped, handshake: { ...this.handshake }, integrity: { ...this.integrity }, detail } }));
  }

  emitIntegrity(detail = '') {
    this.dispatchEvent(new CustomEvent('integrity', { detail: { ...this.snapshot(), detail } }));
  }

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      if (!this.connected || this.synthetic || !this.sessionActive || this.emergencyStopped) return;
      if (this.lastCommandAt && now() - this.lastCommandAt <= this.watchdogMs) return;
      this.integrity.watchdogTrips += 1;
      this.sessionActive = false;
      this.emergencyStop('watchdog').catch(() => {});
      this.emitIntegrity(`No actuator command was received within ${this.watchdogMs} ms; emergency stop latched.`);
    }, Math.min(250, Math.max(50, Math.floor(this.watchdogMs / 3))));
  }

  waitForHandshake(timeoutMs = this.handshakeTimeoutMs) {
    if (this.synthetic || this.handshake.acknowledged) return Promise.resolve({ ...this.handshake });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.removeEventListener('handshake', accepted); reject(new Error(`Controller handshake timed out after ${timeoutMs} ms.`)); }, timeoutMs);
      const accepted = (event) => { clearTimeout(timer); resolve(event.detail); };
      this.addEventListener('handshake', accepted, { once: true });
    });
  }

  async connect(options = {}) {
    if (!this.available) {
      this.connected = true;
      this.synthetic = true;
      this.handshake = { acknowledged: true, controller: 'VIDYUT synthetic controller', firmware: 'browser-fallback', receivedAt: new Date().toISOString() };
      this.status('Synthetic bench-safe controller connected because Web Serial is unavailable.');
      return { synthetic: true };
    }
    this.port = options.port || await navigator.serial.requestPort();
    await this.port.open({ baudRate: options.baudRate || 115200, bufferSize: 65536 });
    const decoder = new TextDecoderStream();
    const encoder = new TextEncoderStream();
    this.port.readable.pipeTo(decoder.writable).catch(() => {});
    encoder.readable.pipeTo(this.port.writable).catch(() => {});
    this.reader = decoder.readable.getReader();
    this.writer = encoder.writable.getWriter();
    this.connected = true;
    this.synthetic = false;
    this.emergencyStopped = false;
    this.sessionActive = false;
    this.handshake = { acknowledged: false, controller: null, firmware: null, receivedAt: null };
    this.lastCommandAt = 0;
    this.lastResponseSequence = null;
    this.readLoop();
    await this.send({ type: 'hello', protocol: this.protocol, benchSafe: true, accepts: ['sensor_frame', 'fault_state'], produces: ['actuator_command', 'telemetry'] });
    this.status('Serial controller connected; handshake sent.');
    this.startWatchdog();
    if (options.requireHandshake !== false) {
      try { await this.waitForHandshake(options.handshakeTimeoutMs); }
      catch (error) { await this.disconnect(); throw error; }
    }
    return { synthetic: false };
  }

  async send(message) {
    if (!this.connected || this.synthetic || !this.writer) return false;
    await this.writer.write(`${JSON.stringify(message)}\n`);
    this.integrity.sent += 1;
    return true;
  }

  async publishSensorFrame(snapshot, environment = {}, activeFaults = []) {
    if (!this.connected || this.emergencyStopped) return;
    if (!this.synthetic && !this.handshake.acknowledged) throw new Error('Cannot inject virtual sensors until the controller handshake is accepted.');
    const timestamp = now();
    if (this.lastTransmit && timestamp - this.lastTransmit < 50) return;
    this.lastTransmit = timestamp;
    if (!this.sessionActive) this.lastCommandAt = timestamp;
    this.sessionActive = true;
    const frame = {
      type: 'sensor_frame', protocol: this.protocol, sequence: ++this.sequence,
      simulationTime: Number(snapshot.t.toFixed(4)), benchSafe: true, physicalOutputsAllowed: false,
      truth: { position: [snapshot.x, snapshot.y, snapshot.altitude], velocity: [snapshot.vx, snapshot.vy, 0], heading: snapshot.heading },
      sensors: { position: [snapshot.observedX, snapshot.observedY, snapshot.altitude], batteryPercent: snapshot.battery, attitudeDeg: snapshot.attitude, stabilityPercent: snapshot.stability, perceptionPercent: snapshot.perception, linkPercent: snapshot.link },
      environment: { id: environment.id, gravity: environment.gravity, airDensity: environment.airDensity, temperature: environment.temperature, wind: environment.wind },
      faults: activeFaults.map((event) => ({ id: event.fault, severity: event.severity }))
    };
    if (this.synthetic) {
      this.receive({ type: 'actuator_command', sequence: frame.sequence, armed: false, outputs: [0.45, 0.46, 0.45, 0.44], controllerState: activeFaults.length ? 'DEGRADED' : 'NOMINAL' });
      return;
    }
    await this.send(frame);
  }

  receive(message) {
    if (!message || typeof message !== 'object') return;
    this.integrity.received += 1;
    this.lastReceiveAt = now();
    if (!this.synthetic && message.type !== 'hello_ack' && !this.handshake.acknowledged) {
      this.integrity.rejected += 1;
      this.emitIntegrity('Controller data was rejected before handshake completion.');
      return;
    }
    if (message.type === 'actuator_command') {
      const declared = (Array.isArray(message.outputs) ? message.outputs : []).slice(0, 32);
      const outputs = declared.map((value) => clamp(value, -1, 1));
      if (declared.some((value, index) => Number(value) !== outputs[index])) this.integrity.saturated += 1;
      if (message.armed === true || message.physicalOutputsAllowed === true) {
        this.integrity.rejected += 1;
        this.emitIntegrity('An armed or physical-output request was overridden by bench-safe mode.');
      }
      if (Number.isInteger(message.sequence)) {
        if (this.lastResponseSequence != null && message.sequence > this.lastResponseSequence + 1) this.integrity.droppedSequences += message.sequence - this.lastResponseSequence - 1;
        if (this.lastResponseSequence != null && message.sequence <= this.lastResponseSequence) this.integrity.outOfOrder += 1;
        this.lastResponseSequence = Math.max(this.lastResponseSequence ?? message.sequence, message.sequence);
      }
      this.lastCommandAt = now();
      this.lastActuators = { ...message, outputs, armed: false, receivedAt: new Date().toISOString(), benchSafeOverride: true };
      this.dispatchEvent(new CustomEvent('actuators', { detail: this.lastActuators }));
    } else if (message.type === 'telemetry' || !message.type) {
      this.lastTelemetry = message;
      this.dispatchEvent(new CustomEvent('telemetry', { detail: message }));
    } else if (message.type === 'hello_ack') {
      if (message.protocol !== this.protocol || message.benchSafe === false || message.physicalOutputsAllowed === true) {
        this.integrity.rejected += 1;
        this.dispatchEvent(new CustomEvent('error', { detail: { message: 'Controller handshake rejected: protocol or bench-safety declaration is incompatible.' } }));
        return;
      }
      this.handshake = { acknowledged: true, controller: message.controller || 'controller', firmware: message.firmware || 'unreported', receivedAt: new Date().toISOString() };
      this.dispatchEvent(new CustomEvent('handshake', { detail: { ...this.handshake } }));
      this.status(`Handshake accepted by ${this.handshake.controller} (${this.handshake.firmware}).`);
    } else if (message.type === 'error') {
      this.dispatchEvent(new CustomEvent('error', { detail: message }));
    }
  }

  async readLoop() {
    let buffer = '';
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { this.receive(JSON.parse(line)); }
          catch { this.integrity.malformed += 1; this.emitIntegrity('Malformed controller JSON line ignored.'); this.dispatchEvent(new CustomEvent('error', { detail: { message: 'Malformed controller JSON line ignored.' } })); }
        }
      }
    } catch (error) {
      this.dispatchEvent(new CustomEvent('error', { detail: { message: error.message } }));
    } finally {
      if (this.connected && !this.synthetic) this.status('Serial input ended.');
    }
  }

  async emergencyStop(reason = 'operator') {
    this.emergencyStopped = true;
    this.sessionActive = false;
    await this.send({ type: 'emergency_stop', protocol: this.protocol, physicalOutputsAllowed: false, reason });
    this.status(`Emergency stop latched (${reason}); sensor injection paused.`);
  }

  async clearEmergencyStop() {
    this.emergencyStopped = false;
    this.lastCommandAt = now();
    await this.send({ type: 'clear_emergency_stop', protocol: this.protocol, physicalOutputsAllowed: false });
    this.status('Emergency stop cleared; bench-safe mode remains active.');
  }

  async signalCheck() {
    if (!this.connected) throw new Error('Connect a controller before sending a signal check.');
    if (!this.synthetic && !this.handshake.acknowledged) throw new Error('Complete the controller handshake before sending a signal check.');
    const message = { type: 'signal_check', protocol: this.protocol, sequence: ++this.sequence, benchSafe: true, physicalOutputsAllowed: false, pattern: 'logical-only' };
    if (this.synthetic) this.receive({ type: 'telemetry', signalCheck: 'acknowledged', sequence: message.sequence, battery: 100, stability: 100 });
    else await this.send(message);
    return message;
  }

  async disconnect() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = null;
    try { if (this.writer) { await this.send({ type: 'session_end', protocol: this.protocol }); await this.writer.close(); } } catch {}
    try { if (this.reader) await this.reader.cancel(); } catch {}
    try { if (this.port) await this.port.close(); } catch {}
    this.port = null; this.reader = null; this.writer = null; this.connected = false; this.synthetic = false; this.sessionActive = false;
    this.handshake = { acknowledged: false, controller: null, firmware: null, receivedAt: null };
    this.status('Controller disconnected.');
  }

  snapshot() {
    return {
      protocol: this.protocol,
      connected: this.connected,
      ready: this.ready,
      synthetic: this.synthetic,
      benchSafe: this.benchSafe,
      emergencyStopped: this.emergencyStopped,
      sessionActive: this.sessionActive,
      watchdogMs: this.watchdogMs,
      handshake: { ...this.handshake },
      integrity: { ...this.integrity },
      lastTelemetry: this.lastTelemetry ? { ...this.lastTelemetry } : null,
      lastActuators: this.lastActuators ? { ...this.lastActuators } : null
    };
  }
}
