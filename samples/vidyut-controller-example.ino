// VIDYUT HIL v1 bench example.
// Requires ArduinoJson 7. Keep every physical actuator disconnected.
#include <ArduinoJson.h>

static String line;
static bool emergencyStopped = false;

void sendHelloAck() {
  Serial.println("{\"type\":\"hello_ack\",\"protocol\":\"vidyut.hil.v1\",\"controller\":\"Arduino bench example\",\"firmware\":\"0.1.0\"}");
}

void sendTelemetry(unsigned long sequence) {
  StaticJsonDocument<256> output;
  output["type"] = "telemetry";
  output["sequence"] = sequence;
  output["battery"] = 100;
  output["stability"] = emergencyStopped ? 0 : 100;
  output["loopRateHz"] = 100;
  serializeJson(output, Serial);
  Serial.println();
}

void sendActuators(unsigned long sequence, float error) {
  StaticJsonDocument<320> output;
  output["type"] = "actuator_command";
  output["sequence"] = sequence;
  output["armed"] = false;
  output["controllerState"] = emergencyStopped ? "ESTOP" : "BENCH_CONTROL";
  JsonArray commands = output["outputs"].to<JsonArray>();
  float base = emergencyStopped ? 0.0f : 0.45f;
  commands.add(constrain(base + error * 0.01f, -1.0f, 1.0f));
  commands.add(constrain(base - error * 0.01f, -1.0f, 1.0f));
  commands.add(base);
  commands.add(base);
  serializeJson(output, Serial);
  Serial.println();
}

void handleLine(const String &json) {
  StaticJsonDocument<1536> input;
  if (deserializeJson(input, json)) return;
  const char *type = input["type"] | "";
  unsigned long sequence = input["sequence"] | 0;
  if (strcmp(type, "hello") == 0) sendHelloAck();
  else if (strcmp(type, "emergency_stop") == 0) emergencyStopped = true;
  else if (strcmp(type, "signal_check") == 0) sendTelemetry(sequence);
  else if (strcmp(type, "sensor_frame") == 0) {
    float sensedX = input["sensors"]["position"][0] | 0.0f;
    const float demoTargetX = 82.0f;
    sendActuators(sequence, demoTargetX - sensedX);
  }
}

void setup() {
  Serial.begin(115200);
  line.reserve(1536);
}

void loop() {
  while (Serial.available()) {
    char value = (char)Serial.read();
    if (value == '\n') { handleLine(line); line = ""; }
    else if (value != '\r' && line.length() < 1500) line += value;
  }
}
