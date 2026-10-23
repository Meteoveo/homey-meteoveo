'use strict';

const Homey = require('homey');
const { InvalidKey, ServiceUnavailable } = require('../../lib/client');
const { capabilityValues, localDate } = require('../../lib/convert');
const { initialRainState, nextRainState, rainWithinMinutes } = require('../../lib/rain');
const { newWarnings, levelAtLeast } = require('../../lib/warnings');
const { buildWuParams, freshReadings, DailyRain } = require('../../lib/wu');

// The contract asks for at most one forecast request per five minutes.
const POLL_MS = 5 * 60_000;
// One upload per minute: the rate consumer stations report at.
const UPLOAD_MS = 60_000;
// A Flow-reported reading older than this is not sent: a stalled source must
// show up as a gap at MeteoVeo, not as a frozen value.
const FLOW_READING_MAX_AGE_MS = 15 * 60_000;
const OUTAGE_WARNING_AFTER = 3;

// Homey's internal units for the capabilities a source device may offer.
const DEFAULT_UNITS = {
  measure_temperature: '°C',
  measure_humidity: '%',
  measure_pressure: 'mbar',
  measure_wind_strength: 'km/h',
  measure_gust_strength: 'km/h',
  measure_wind_angle: '°',
  meter_rain: 'mm',
};

function utcStamp(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
}

class MeteoVeoDevice extends Homey.Device {
  async onInit() {
    this._home = null;
    this._etag = null;
    this._failures = 0;
    this._pausedUntil = 0;
    this._readings = {};
    this._dailyRain = DailyRain.fromJSON(this.getStoreValue('dailyRain'));

    for (const capability of this.driver.manifest.capabilities) {
      if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    }

    if (!this.getStoreValue('key')) {
      await this.setUnavailable(this.homey.__('errors.signed_out'));
      return;
    }
    this._start();
  }

  _start() {
    this._stop();
    this._pollTimer = this.homey.setInterval(() => this._safe(this.refresh()), POLL_MS);
    this._safe(this.refresh());
    if (this.getStoreValue('station')) {
      this._uploadTimer = this.homey.setInterval(() => this._safe(this._uploadOnce()), UPLOAD_MS);
    }
  }

  _stop() {
    if (this._pollTimer) this.homey.clearInterval(this._pollTimer);
    if (this._uploadTimer) this.homey.clearInterval(this._uploadTimer);
    this._pollTimer = null;
    this._uploadTimer = null;
  }

  _safe(promise) {
    // Never an unhandled rejection; messages carry no secrets (lib/client).
    promise.catch((err) => this.error(err && err.message));
  }

  _lang() {
    return this.homey.i18n.getLanguage() === 'es' ? 'es' : 'en';
  }

  _tz() {
    return this.homey.clock.getTimezone();
  }

  // --- Forecast ------------------------------------------------------------

  async refresh({ force = false } = {}) {
    const key = this.getStoreValue('key');
    if (!key) throw new Error(this.homey.__('errors.signed_out'));
    if (!force && Date.now() < this._pausedUntil) return;

    let result;
    try {
      result = await this.homey.app.client.home(key, { lang: this._lang(), etag: force ? null : this._etag });
    } catch (err) {
      if (err instanceof InvalidKey) {
        await this._keyRejected();
        if (force) throw new Error(this.homey.__('errors.key_revoked'));
        return;
      }
      if (err instanceof ServiceUnavailable) {
        this._failures += 1;
        if (err.retryAfterSeconds) this._pausedUntil = Date.now() + err.retryAfterSeconds * 1000;
        if (this._failures >= OUTAGE_WARNING_AFTER) await this.setWarning(this.homey.__('errors.unavailable')).catch(this.error);
        if (force) throw new Error(this.homey.__('errors.unavailable'));
        return;
      }
      throw err;
    }

    if (this._failures) {
      this._failures = 0;
      await this.unsetWarning().catch(this.error);
    }
    if (!this.getAvailable()) await this.setAvailable();
    if (result.notModified) return;
    this._etag = result.etag;
    this._home = result.data;
    await this._apply(result.data);
  }

  async _apply(home) {
    const values = capabilityValues(home, { timezone: this._tz() });
    for (const [capability, value] of Object.entries(values)) {
      // null shows "no value" in Homey — the honest state when the service has
      // no reading; a zero would be a false measurement.
      if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(this.error);
    }

    const now = Date.now();
    const rain = nextRainState(this.getStoreValue('rainState') || initialRainState(), home.nextHour, now);
    await this.setStoreValue('rainState', rain.state);
    for (const event of rain.events) {
      await this._trigger(event.type, event.type === 'rain_expected' ? { minutes: event.minutes ?? 0 } : {});
    }

    const warnings = newWarnings(home.warnings, this.getStoreValue('seenWarnings') || [], now);
    await this.setStoreValue('seenWarnings', warnings.seen);
    for (const w of warnings.fresh) {
      await this._trigger('warning_issued', {
        level: this.homey.__(`levels.${w.level}`),
        phenomenon: w.phenomenonName || w.phenomenon || '',
        headline: w.headline || '',
        onset: this._when(w.onset),
        expires: this._when(w.expires),
      });
    }

    const icon = values.meteoveo_condition;
    const lastIcon = this.getStoreValue('lastIcon');
    if (icon !== 'ismeretlen') {
      if (lastIcon && icon !== lastIcon) {
        await this._trigger('condition_changed', { condition: this.homey.__(`conditions.${icon}`) });
      }
      await this.setStoreValue('lastIcon', icon);
    }
  }

  _when(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('es-ES', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: this._tz(),
    }).format(date).replace(',', '');
  }

  _trigger(cardId, tokens) {
    return this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens).catch(this.error);
  }

  async _keyRejected() {
    this._stop();
    await this.setUnavailable(this.homey.__('errors.key_revoked')).catch(this.error);
  }

  // --- Flow conditions --------------------------------------------------------

  async rainWithin(minutes) {
    if (!this._home) await this.refresh({ force: true });
    const answer = rainWithinMinutes(this._home && this._home.nextHour, minutes, Date.now());
    if (answer === null) throw new Error(this.homey.__('errors.no_nowcast'));
    return answer;
  }

  async warningActive(level) {
    return levelAtLeast(this.getCapabilityValue('meteoveo_warning'), level);
  }

  // --- Station ----------------------------------------------------------------

  async report(measurement, value, unit) {
    if (!this.getStoreValue('station')) throw new Error(this.homey.__('errors.no_station'));
    const sources = this.getStoreValue('stationSources') || {};
    // One source per measurement: mixing a device and a Flow into one series
    // would make the data meaningless.
    if (sources[measurement]) throw new Error(this.homey.__('errors.measurement_from_device'));
    this._readings[measurement] = { value: Number(value), unit, at: Date.now() };
  }

  async _readSources(now) {
    const sources = this.getStoreValue('stationSources') || {};
    if (!Object.keys(sources).length) return;
    const api = await this.homey.app.api();
    for (const [measurement, source] of Object.entries(sources)) {
      let device;
      try {
        device = await api.devices.getDevice({ id: source.deviceId });
      } catch {
        delete this._readings[measurement];
        continue;
      }
      const state = (device.capabilitiesObj || {})[source.capability];
      if (device.available === false || !state || typeof state.value !== 'number') {
        delete this._readings[measurement];
        continue;
      }
      let { value } = state;
      let unit = state.units || DEFAULT_UNITS[source.capability] || '';
      if (measurement === 'daily_rain') {
        value = this._dailyRain.update(state.value, localDate(now, this._tz()));
        unit = 'mm';
        await this.setStoreValue('dailyRain', this._dailyRain.toJSON());
      }
      this._readings[measurement] = { value, unit, at: now };
    }
  }

  async _uploadOnce() {
    const station = this.getStoreValue('station');
    if (!station) return;
    const now = Date.now();
    if (this.getStoreValue('stationMode') === 'devices') await this._readSources(now);
    const params = buildWuParams(freshReadings(this._readings, now, FLOW_READING_MAX_AGE_MS));
    if (!Object.keys(params).length) return;
    try {
      await this.homey.app.client.upload(station, params, utcStamp(now));
    } catch (err) {
      if (err instanceof InvalidKey) {
        if (this._uploadTimer) this.homey.clearInterval(this._uploadTimer);
        this._uploadTimer = null;
        await this.setWarning(this.homey.__('errors.station_key_rejected')).catch(this.error);
        return;
      }
      if (err instanceof ServiceUnavailable) return;
      throw err;
    }
  }

  // --- Repair -------------------------------------------------------------------

  async replaceKey(issued) {
    await this.setStoreValue('key', issued.key);
    await this.setStoreValue('keyId', issued.keyId);
    if (issued.place) await this.setStoreValue('place', issued.place);
    this._etag = null;
    await this.setAvailable();
    await this.unsetWarning().catch(this.error);
    this._start();
  }

  async locationChanged(place) {
    const before = this.getStoreValue('place');
    // A name the user never changed ("MeteoVeo <old town>") follows the move.
    if (place && place.name && before && before.name && this.getName() === `MeteoVeo ${before.name}`) {
      await this.setName(`MeteoVeo ${place.name}`).catch(this.error);
    }
    if (place) await this.setStoreValue('place', place);
    this._etag = null;
    await this.refresh({ force: true });
  }

  async accountDeleted() {
    this._stop();
    // The server deleted the keys with the account; nothing secret stays here.
    await this.setStoreValue('key', null);
    await this.setStoreValue('station', null);
    await this.setUnavailable(this.homey.__('errors.account_deleted')).catch(this.error);
    await this.homey.notifications.createNotification({ excerpt: this.homey.__('notifications.account_deleted') })
      .catch(this.error);
  }

  // --- Widget -------------------------------------------------------------------

  widgetData() {
    const home = this._home;
    if (!home) return { state: this.getAvailable() ? 'loading' : 'unavailable' };
    return {
      state: 'ok',
      name: this.getName(),
      timezone: this._tz(),
      level: home.level,
      place: home.place,
      current: home.current,
      nextHour: home.nextHour,
      hourly: (home.hourly || []).slice(0, 12),
      warnings: home.warnings || [],
      attribution: home.attribution,
    };
  }

  // --- Lifecycle -------------------------------------------------------------

  async onDeleted() {
    this._stop();
    const key = this.getStoreValue('key');
    // Removing the device revokes only this key; the account, the station and
    // its measurements stay. A network failure must not block the removal.
    if (key) await this.homey.app.client.revokeKey(key).catch(this.error);
  }

  async onUninit() {
    this._stop();
  }
}

module.exports = MeteoVeoDevice;
