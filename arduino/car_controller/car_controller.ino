/*
 * Samar Arduino Car - BLE peripheral
 * Board: Arduino UNO R4 WiFi
 *
 * Phone (Android Chrome) connects over Web Bluetooth and writes 1-byte
 * commands to the "command" characteristic:
 *   'F' (0x46) drive forward
 *   'L' (0x4C) turn left
 *   'R' (0x52) turn right
 *   'S' (0x53) stop
 *
 * Motor functions are mocked. Wire your real driver in the marked stubs.
 */

#include <ArduinoBLE.h>

static const char* DEVICE_NAME = "SamarCar";

// Custom 128-bit UUIDs (generated, keep in sync with phone-app/app.js)
static const char* SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char* CMD_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

BLEService carService(SERVICE_UUID);
BLEByteCharacteristic cmdChar(CMD_CHAR_UUID, BLEWrite | BLEWriteWithoutResponse);

// Safety: if no command arrives for this long, stop.
static const unsigned long COMMAND_TIMEOUT_MS = 500;
unsigned long lastCommandAt = 0;
char lastCommand = 'S';

void drive_forward() {
  // TODO: wire to real motor driver
  Serial.println("[motor] forward");
}

void turn_left() {
  // TODO: wire to real motor driver
  Serial.println("[motor] left");
}

void turn_right() {
  // TODO: wire to real motor driver
  Serial.println("[motor] right");
}

void stop_motors() {
  // TODO: wire to real motor driver
  Serial.println("[motor] stop");
}

void applyCommand(char c) {
  if (c == lastCommand) return;
  lastCommand = c;
  switch (c) {
    case 'F': drive_forward(); break;
    case 'L': turn_left(); break;
    case 'R': turn_right(); break;
    case 'S':
    default:  stop_motors(); break;
  }
}

void onCmdWritten(BLEDevice central, BLECharacteristic ch) {
  uint8_t value = 0;
  ch.readValue(value);
  lastCommandAt = millis();
  applyCommand((char)value);
}

void onConnect(BLEDevice central) {
  Serial.print("connected: ");
  Serial.println(central.address());
  lastCommandAt = millis();
}

void onDisconnect(BLEDevice central) {
  Serial.print("disconnected: ");
  Serial.println(central.address());
  applyCommand('S');
}

void setup() {
  Serial.begin(115200);
  // Don't block forever waiting for serial; car runs headless.
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 2000) {}

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  if (!BLE.begin()) {
    Serial.println("BLE.begin() failed");
    while (1) {
      digitalWrite(LED_BUILTIN, HIGH); delay(100);
      digitalWrite(LED_BUILTIN, LOW);  delay(100);
    }
  }

  BLE.setLocalName(DEVICE_NAME);
  BLE.setDeviceName(DEVICE_NAME);
  BLE.setAdvertisedService(carService);

  carService.addCharacteristic(cmdChar);
  BLE.addService(carService);

  cmdChar.writeValue((uint8_t)'S');
  cmdChar.setEventHandler(BLEWritten, onCmdWritten);

  BLE.setEventHandler(BLEConnected, onConnect);
  BLE.setEventHandler(BLEDisconnected, onDisconnect);

  BLE.advertise();
  Serial.print("advertising as ");
  Serial.println(DEVICE_NAME);
}

void loop() {
  BLE.poll();

  // Heartbeat: LED on when a central is connected.
  digitalWrite(LED_BUILTIN, BLE.central() ? HIGH : LOW);

  // Safety stop on stale commands.
  if (lastCommand != 'S' && millis() - lastCommandAt > COMMAND_TIMEOUT_MS) {
    applyCommand('S');
  }
}
