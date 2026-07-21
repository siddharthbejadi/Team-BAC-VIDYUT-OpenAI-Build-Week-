export class GripperBridge extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false;
    this.sequence = 0;
  }

  get available() { return 'serial' in navigator; }

  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  async connect() {
    if (!this.available) throw new Error('Web Serial requires Chrome or Edge on desktop.');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200 });
    const decoder = new TextDecoderStream();
    const encoder = new TextEncoderStream();
    this.port.readable.pipeTo(decoder.writable).catch(() => {});
    encoder.readable.pipeTo(this.port.writable).catch(() => {});
    this.reader = decoder.readable.getReader();
    this.writer = encoder.writable.getWriter();
    this.connected = true;
    this.readLoop();
    await this.send('HELLO');
    this.emit('status', 'Serial connected at 115200 baud');
  }

  async send(line) {
    if (!this.connected || !this.writer) throw new Error('Connect the controller first.');
    await this.writer.write(`${line}\n`);
    this.emit('tx', line);
  }

  async move(offset) { await this.send(`MOVE,${++this.sequence},${Number(offset)}`); }
  async center() { await this.send(`CENTER,${++this.sequence}`); }
  async stop() { await this.send(`STOP,${++this.sequence}`); }

  receive(line) {
    this.emit('rx', line);
    const ack = line.match(/^ACK,(\d+),(MOVE|CENTER),(-?\d+(?:\.\d+)?),(\d+)/);
    if (ack) this.emit('ack', { sequence: Number(ack[1]), command: ack[2], offset: Number(ack[3]), count: Number(ack[4]), raw: line });
    if (line.startsWith('ERR,')) this.emit('rejected', line);
    if (line.startsWith('HELLO_ACK,')) this.emit('status', 'VIDYUT controller authenticated');
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
        lines.filter(Boolean).forEach((line) => this.receive(line.trim()));
      }
    } catch (error) { this.emit('error', error.message); }
  }

  async disconnect() {
    try { if (this.reader) await this.reader.cancel(); } catch {}
    try { if (this.writer) await this.writer.close(); } catch {}
    try { if (this.port) await this.port.close(); } catch {}
    this.port = this.reader = this.writer = null;
    this.connected = false;
    this.emit('status', 'Controller disconnected');
  }
}
