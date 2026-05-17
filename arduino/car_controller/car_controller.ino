/*
 * Samar Arduino Car - BLE peripheral
 * Board: Arduino UNO R4 WiFi
 *
 * Phone (Android Chrome) connects over Web Bluetooth and writes a single
 * unsigned byte to the "steer" characteristic. The byte encodes steering
 * position derived from the target's horizontal offset in the camera frame:
 *
 *   0   = target far left  (full left steer)
 *   128 = target centered  (neutral)
 *   255 = target far right (full right steer)
 *
 * The R4 mirrors this byte directly onto pin 13 via analogWrite() so a
 * downstream driver (servo channel, motor mixer, scope) can use it.
 *
 * Safety: if no value arrives for 500 ms, output snaps back to 128 (neutral).
 */

#include <ArduinoBLE.h>

static const char* DEVICE_NAME = "SamarCar";

// Custom 128-bit UUIDs (must match phone-app/app.js)
static const char* SERVICE_UUID  = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char* STEER_UUID    = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";

static const int STEER_PIN = 13;
static const uint8_t NEUTRAL = 128;
static const unsigned long COMMAND_TIMEOUT_MS = 500;

BLEService carService(SERVICE_UUID);
BLEByteCharacteristic steerChar(STEER_UUID, BLEWrite | BLEWriteWithoutResponse);

unsigned long lastCommandAt = 0;
uint8_t lastSteer = NEUTRAL;

void applySteer(uint8_t v) {
  lastSteer = v;
  analogWrite(STEER_PIN, v);
  Serial.print("[steer] ");
  Serial.println(v);
}

void onSteerWritten(BLEDevice central, BLECharacteristic ch) {
  uint8_t value = 0;
  ch.readValue(value);
  lastCommandAt = millis();
  applySteer(value);
}

void onConnect(BLEDevice central) {
  Serial.print("connected: ");
  Serial.println(central.address());
  lastCommandAt = millis();
  applySteer(NEUTRAL);
}

void onDisconnect(BLEDevice central) {
  Serial.print("disconnected: ");
  Serial.println(central.address());
  applySteer(NEUTRAL);
}

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 2000) {}

  pinMode(STEER_PIN, OUTPUT);
  analogWrite(STEER_PIN, NEUTRAL);

  if (!BLE.begin()) {
    Serial.println("BLE.begin() failed");
    while (1) { delay(1000); }
  }

  BLE.setLocalName(DEVICE_NAME);
  BLE.setDeviceName(DEVICE_NAME);
  BLE.setAdvertisedService(carService);

  carService.addCharacteristic(steerChar);
  BLE.addService(carService);

  steerChar.writeValue(NEUTRAL);
  steerChar.setEventHandler(BLEWritten, onSteerWritten);

  BLE.setEventHandler(BLEConnected,    onConnect);
  BLE.setEventHandler(BLEDisconnected, onDisconnect);

  BLE.advertise();
  Serial.print("advertising as ");
  Serial.println(DEVICE_NAME);
}

void loop() {
  BLE.poll();

  // Safety neutral on stale commands.
  if (lastSteer != NEUTRAL && millis() - lastCommandAt > COMMAND_TIMEOUT_MS) {
    applySteer(NEUTRAL);
  }
}
