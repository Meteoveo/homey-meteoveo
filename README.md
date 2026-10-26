# MeteoVeo for Homey Pro

Hyperlocal weather for Spain in Homey: next-hour rain, current conditions, AEMET warnings, Flow cards, a dashboard widget, and optional upload from your own weather station.

- **Install:** search for *MeteoVeo* in the Homey App Store (Homey Pro only).
- **Account:** created or signed in during pairing — e-mail, password, e-mail code. The password is used once and never stored; Homey keeps a limited key that can read the forecast for one location (and upload to your station), nothing else.
- **Remove vs. delete:** removing the device revokes only this Homey's key. Deleting the MeteoVeo account is under *Device → Repair*.
- **Weather station:** send its readings with the *Send … to MeteoVeo* Flow cards (one per measurement), for example from a When-card of your station's device.

## Flow cards

| Type | Card |
|---|---|
| When | Rain is on its way (token: minutes) · It started raining · It stopped raining · A weather warning is issued · The weather changed |
| And | It will rain within 10/20/30/60/120 minutes · A warning of level … or higher is active |
| Then | Send temperature / humidity / station pressure / wind speed / wind gust / wind direction / rain today / solar radiation · Update the forecast now |

## Development

```sh
npm install
npm test                                 # unit tests (node:test)
npx homey app validate --level publish   # App Store checks
npx homey app run --remote               # run on your Homey Pro
```

The server side is the MeteoVeo integration contract v1 (shared with [ha-meteoveo](https://github.com/Meteoveo/ha-meteoveo)): `GET /v1/integration/home` with an `mvik_…` key, polled every 5 minutes with ETag, `User-Agent: homey-meteoveo/<version>`.

## License

MIT
