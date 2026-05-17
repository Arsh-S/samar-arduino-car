# Samar Arduino Car

A robotic car controlled by an Android phone running in-browser object detection.
The Arduino UNO R4 WiFi acts as a BLE peripheral. The phone (Chrome on Android)
loads a static web page, runs the rear camera + COCO-SSD object detection, and
sends 1-byte drive commands (`F`/`L`/`R`/`S`) over Web Bluetooth.

## Architecture

```
[Android phone, Chrome]                      [Arduino UNO R4 WiFi]
   camera --> COCO-SSD (TFJS)                   ArduinoBLE peripheral
        \--> steering policy                          ^
              \--> Web Bluetooth GATT write -----------/  --> mock motor stubs
```

- Page hosted on GitHub Pages (HTTPS required by Web Bluetooth).
- BLE service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`, write characteristic
  `6e400002-...`.
- Commands: `F` forward, `L` left, `R` right, `S` stop.
- Safety: R4 stops motors if no command arrives for 500 ms.

## Repo layout

```
arduino/car_controller/car_controller.ino   # R4 BLE peripheral sketch
phone-app/index.html                        # Web app entry point
phone-app/app.js                            # Camera + COCO-SSD + BLE + steering
phone-app/styles.css
```

## Flashing the Arduino (arduino-cli)

One-time setup:

```bash
brew install arduino-cli
arduino-cli core update-index
arduino-cli core install arduino:renesas_uno
arduino-cli lib install ArduinoBLE
```

Find the board:

```bash
arduino-cli board list
# Look for "Arduino UNO R4 WiFi", note the /dev/cu.usbmodem... port.
```

Compile + upload:

```bash
PORT=/dev/cu.usbmodemXXXXXXX  # from `board list`
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi arduino/car_controller
arduino-cli upload -p "$PORT" --fqbn arduino:renesas_uno:unor4wifi arduino/car_controller
```

Watch serial output:

```bash
arduino-cli monitor -p "$PORT" -c baudrate=115200
```

You should see `advertising as SamarCar`, then `connected: <mac>` when the phone
attaches, then `[motor] forward` / `left` / `right` / `stop` lines as the phone
sends commands.

## Wiring real motors

The sketch ships with mocked motor functions. Replace the bodies of
`drive_forward()`, `turn_left()`, `turn_right()`, `stop_motors()` in
`arduino/car_controller/car_controller.ino` with the calls for your motor
driver (L298N, TB6612FNG, etc.).

## Deploying the phone app to GitHub Pages

Web Bluetooth requires a secure origin, so the page must be served over HTTPS.
GitHub Pages is the easiest option.

```bash
cd /Users/arsh/Documents/Projects/samar-arduino-car
git init
git add .
git commit -m "initial commit"
# Create a repo on github.com (do not push without permission).
# Then:
git remote add origin git@github.com:<you>/samar-arduino-car.git
git branch -M main
git push -u origin main
```

In the GitHub repo settings, enable **Pages**:

- Source: `Deploy from a branch`
- Branch: `main`, folder: `/` (root)

Then the app will be live at:

```
https://<you>.github.io/samar-arduino-car/phone-app/
```

## Using the phone app

1. Power the R4 (USB battery pack works). The built-in LED stays off while
   advertising, turns on solid when a phone is connected.
2. On the Android phone, open the GitHub Pages URL in Chrome.
3. Grant camera access.
4. Wait for the **Model: ready** pill to turn green.
5. Tap **Connect car**. Pick `SamarCar` from the BLE chooser.
6. Pick a target class from the dropdown (default `person`).
7. Tap **Autopilot: OFF** to flip it on. The car will:
   - Drive forward when the target is roughly centered
   - Turn left when the target is left of the deadband
   - Turn right when the target is right of the deadband
   - Stop if no target is in view

The deadband is 15% of frame width on either side of center.

## Tuning

- **Target class:** dropdown in the HUD. Any of the 80 COCO-SSD classes.
- **Min confidence:** slider in the HUD. Raise it if false positives steer the
  car around. Lower if a real target keeps being ignored.
- **Steering deadband / detection model:** edit `decide()` and the
  `cocoSsd.load({ base: "lite_mobilenet_v2" })` call in `phone-app/app.js`.
  Swap to `base: "mobilenet_v2"` for higher accuracy at lower fps.

## Troubleshooting

- **`requestDevice` errors with "Web Bluetooth API is not available":** the
  page is not on a secure origin. Use HTTPS (GitHub Pages) or `localhost`.
- **Chrome can't find `SamarCar`:** confirm the R4 is powered and the serial
  monitor shows `advertising as SamarCar`. Toggle Bluetooth off/on on the
  phone. Make sure no other device has an active BLE session with the R4
  (only one central at a time).
- **Page loads but model never becomes ready:** TFJS model weights are fetched
  from a CDN. The phone needs internet on first load. Once cached by the
  browser, the page works offline as long as Chrome keeps the cache.
- **Camera shows the front camera:** the app requests `facingMode:
  "environment"`. Some phones still pick the front camera; close the tab,
  revoke camera permission in Chrome's site settings, reload, re-grant.
- **Commands lag:** lower the COCO-SSD `maxNumBoxes` (currently 10) or switch
  to `lite_mobilenet_v2` if not already.
