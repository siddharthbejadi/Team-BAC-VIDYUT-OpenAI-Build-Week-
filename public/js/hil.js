const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

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
  }

  get available() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  status(detail = '') {
    this.dispatchEvent(new CustomEvent('status', { detail: { connected: this.connected, synthetic: this.synthetic, benchSafe: this.benchSafe, emergencyStopped: this.emergencyStopped, detail } }));
  }

  async connect(options = {}) {
    if (!this.available) {
      this.connected = true;
      this.synthetic = true;
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
    this.readLoop();
    await this.send({ type: 'hello', protocol: this.protocol, benchSafe: true, accepts: ['sensor_frame', 'fault_state'], produces: ['actuator_command', 'telemetry'] });
    this.status('Serial controller connected; handshake sent.');
    return { synthetic: false };
  }

  async send(message) {
    if (!this.connected || this.synthetic || !this.writer) return false;
    await this.writer.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  async publishSensorFrame(snapshot, environment = {}, activeFaults = []) {
    if (!this.connected || this.emergencyStopped) return;
    const now = performance.now();
    if (now - this.lastTransmit < 50) return;
    this.lastTransmit = now;
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
    if (message.type === 'actuator_command') {
      const outputs = (Array.isArray(message.outputs) ? message.outputs : []).slice(0, 32).map((value) => clamp(value, -1, 1));
      this.lastActuators = { ...message, outputs, armed: false, receivedAt: new Date().toISOString(), benchSafeOverride: true };
      this.dispatchEvent(new CustomEvent('actuators', { detail: this.lastActuators }));
    } else if (message.type === 'telemetry' || !message.type) {
      this.lastTelemetry = message;
      this.dispatchEvent(new CustomEvent('telemetry', { detail: message }));
    } else if (message.type === 'hello_ack') {
      this.status(`Handshake accepted by ${message.controller || 'controller'}.`);
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
          catch { this.dispatchEvent(new CustomEvent('error', { detail: { message: 'Malformed controller JSON line ignored.' } })); }
        }
      }
    } catch (error) {
      this.dispatchEvent(new CustomEvent('error', { detail: { message: error.message } }));
    } finally {
      if (this.connected && !this.synthetic) this.status('Serial input ended.');
    }
  }

  async emergencyStop() {
    this.emergencyStopped = true;
    await this.send({ type: 'emergency_stop', protocol: this.protocol, physicalOutputsAllowed: false, reason: 'operator' });
    this.status('Emergency stop latched; sensor injection paused.');
  }

  clearEmergencyStop() {
    this.emergencyStopped = false;
    this.status('Emergency stop cleared; bench-safe mode remains active.');
  }

  async signalCheck() {
    const message = { type: 'signal_check', protocol: this.protocol, sequence: ++this.sequence, benchSafe: true, physicalOutputsAllowed: false, pattern: 'logical-only' };
    if (this.synthetic) this.receive({ type: 'telemetry', signalCheck: 'acknowledged', sequence: message.sequence, battery: 100, stability: 100 });
    else await this.send(message);
    return message;
  }

  async disconnect() {
    try { if (this.writer) { await this.send({ type: 'session_end', protocol: this.protocol }); await this.writer.close(); } } catch {}
    try { if (this.reader) await this.reader.cancel(); } catch {}
    try { if (this.port) await this.port.close(); } catch {}
    this.port = null; this.reader = null; this.writer = null; this.connected = false; this.synthetic = false;
    this.status('Controller disconnected.');
  }
}
