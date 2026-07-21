#include "mbed.h"
#include <cmath>
#include <cstdio>
#include <cstring>

I2C i2c(PB_9, PB_8);
BufferedSerial pc(USBTX, USBRX, 115200);

constexpr int PCA_ADDR = 0x40 << 1;
constexpr uint8_t CHANNEL = 0;
constexpr int CENTRE = 307;
constexpr float COUNTS_PER_DEGREE = 205.0f / 120.0f;
constexpr float MAX_OFFSET_DEG = 8.0f; // temporary installed-joint limit
int currentCount = CENTRE;

bool writeReg(uint8_t reg, uint8_t value) {
    char data[2] = {static_cast<char>(reg), static_cast<char>(value)};
    return i2c.write(PCA_ADDR, data, 2) == 0;
}

bool readReg(uint8_t reg, uint8_t &value) {
    char address = static_cast<char>(reg), result = 0;
    if (i2c.write(PCA_ADDR, &address, 1, true) != 0 || i2c.read(PCA_ADDR, &result, 1) != 0) return false;
    value = static_cast<uint8_t>(result); return true;
}

bool initPca() {
    uint8_t oldMode = 0;
    if (!readReg(0x00, oldMode)) return false;
    if (!writeReg(0x00, (oldMode & 0x7F) | 0x10) || !writeReg(0xFE, 121) || !writeReg(0x00, oldMode)) return false;
    ThisThread::sleep_for(1ms);
    return writeReg(0x00, oldMode | 0xA0);
}

bool setPwm(int count) {
    char data[5] = {static_cast<char>(0x06 + 4 * CHANNEL), 0, 0, static_cast<char>(count & 0xFF), static_cast<char>((count >> 8) & 0x0F)};
    return i2c.write(PCA_ADDR, data, 5) == 0;
}

void disablePwm() {
    char data[5] = {static_cast<char>(0x06 + 4 * CHANNEL), 0, 0, 0, 0x10};
    i2c.write(PCA_ADDR, data, 5);
}

bool moveSlowly(int target) {
    while (currentCount != target) {
        currentCount += target > currentCount ? 1 : -1;
        if (!setPwm(currentCount)) return false;
        ThisThread::sleep_for(25ms);
    }
    return true;
}

void send(const char *line) { pc.write(line, strlen(line)); }

void command(char *line) {
    unsigned long sequence = 0; float offset = 0;
    if (!strcmp(line, "HELLO")) { send("HELLO_ACK,vidyut.gripper.v1,NUCLEO-G474RE,PCA9685,CH0\r\n"); return; }
    if (sscanf(line, "MOVE,%lu,%f", &sequence, &offset) == 2) {
        char response[100];
        if (offset < -MAX_OFFSET_DEG || offset > MAX_OFFSET_DEG) {
            snprintf(response, sizeof(response), "ERR,%lu,OUT_OF_RANGE,ALLOWED=-8_TO_8\r\n", sequence);
        } else {
            int target = CENTRE + static_cast<int>(lroundf(offset * COUNTS_PER_DEGREE));
            if (!moveSlowly(target)) snprintf(response, sizeof(response), "ERR,%lu,I2C_FAILURE\r\n", sequence);
            else snprintf(response, sizeof(response), "ACK,%lu,MOVE,%.1f,%d\r\n", sequence, offset, currentCount);
        }
        send(response); return;
    }
    if (sscanf(line, "CENTER,%lu", &sequence) == 1) {
        char response[80];
        if (moveSlowly(CENTRE)) snprintf(response, sizeof(response), "ACK,%lu,CENTER,0.0,%d\r\n", sequence, currentCount);
        else snprintf(response, sizeof(response), "ERR,%lu,I2C_FAILURE\r\n", sequence);
        send(response); return;
    }
    if (sscanf(line, "STOP,%lu", &sequence) == 1) {
        char response[80]; disablePwm();
        snprintf(response, sizeof(response), "ACK,%lu,STOP,OUTPUT_DISABLED\r\n", sequence); send(response); return;
    }
    send("ERR,0,UNKNOWN_COMMAND\r\n");
}

int main() {
    i2c.frequency(100000); pc.set_blocking(false);
    if (!initPca()) { send("FATAL,PCA9685_NOT_FOUND,EXPECTED=0x40\r\n"); while (true) ThisThread::sleep_for(1s); }
    disablePwm(); send("READY,SEND_HELLO\r\n");
    char line[64]; size_t position = 0;
    while (true) {
        char c;
        while (pc.read(&c, 1) == 1) {
            if (c == '\n' || c == '\r') { if (position) { line[position] = 0; command(line); position = 0; } }
            else if (position < sizeof(line) - 1) line[position++] = c;
            else position = 0;
        }
        ThisThread::sleep_for(5ms);
    }
}
