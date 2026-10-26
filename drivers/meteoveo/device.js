'use strict';

const Homey = require('homey');
const { InvalidKey, ServiceUnavailable } = require('../../lib/client');
const { ICON_KEYS, capabilityValues } = require('../../lib/convert');
const { initialRainState, nextRainState, rainWithinMinutes, rainIntensityWithin } = require('../../lib/rain');
const { newWarnings, levelAtLeast, levelTransition, phenomenonActive } = require('../../lib/warnings');
const { dailyCapabilityValues, dayForecast, precipChance } = require('../../lib/forecast');
const {
  comfortCapabilityValues, maxGustWithin, isSunny, tropicalNight, coolerOutside, warningNotice,
} = require('../../lib/comfort');
const { buildWuParams, freshReadings } = require('../../lib/wu');
const { upgradeStationStore } = require('../../lib/pairing');
const { initialLightningState, nextLightningState, compass, lightningWithin, lightningCapability } = require('../../lib/lightning');

// The contract asks for at most one forecast request per five minutes.
const POLL_MS = 5 * 60_000;
// One upload per minute: the rate consumer stations report at.
const UPLOAD_MS = 60_000;
// A Flow-reported reading older than this is not sent: a stalled source must
// show up as a gap at MeteoVeo, not as a frozen value.
const FLOW_READING_MAX_AGE_MS = 15 * 60_000;
const OUTAGE_WARNING_AFTER = 3;
// The radar picture changes with each 10-minute slice; asking more often only repeats it.
const RADAR_IMAGE_MS = 10 * 60_000;
// The climate tip waits until the user has chosen the zone after pairing.
const CLIMATE_ADVICE_DELAY_MS = 10 * 60_000;

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

    for (const capability of this.driver.manifest.capabilities) {
      if (!this.hasCapability(capability)) await this.addCapability(capability).catch(this.error);
    }

    if (!this.getStoreValue('key')) {
      await this.setUnavailable(this.homey.__('errors.signed_out'));
      return;
    }
    // Defaults Homey did not fill in (seen as "-" after a custom pairing).
    if (this.getSetting('notify_warnings') == null) await this.setSettings({ notify_warnings: 'orange', notify_rain: false }).catch(this.error);
    await this._upgradeStation();
    if (!this.getStoreValue('climateAdviceDone')) {
      this._adviceTimer = this.homey.setTimeout(() => this._safe(this._climateAdvice()), CLIMATE_ADVICE_DELAY_MS);
    }
    this._start();
  }

  /**
   * The radar picture as the device's camera image and as the image token of
   * the rain and warning triggers (contract v1 section 6, JPEG "now" frame).
   * Homey fetches it lazily; update() after a new radar slice (10 min).
   */
  async _setupRadarImage() {
    if (this._radarImage) return;
    try {
      const image = await this.homey.images.createImage();
      image.setStream(async (stream) => {
        const key = this.getStoreValue('key');
        if (!key) throw new Error(this.homey.__('errors.signed_out'));
        const { buffer } = await this.homey.app.client.radarImage(key, { lang: this._lang() });
        stream.contentType = 'image/jpeg';
        stream.filename = 'meteoveo-radar.jpg';
        stream.end(buffer);
      });
      this._radarImage = image;
      this._radarUpdatedAt = Date.now();
      await this.setCameraImage('radar', this.homey.__('camera.radar'), image);
    } catch (err) {
      // An old Homey without camera images still gets everything else.
      this.error('radar image unavailable:', err && err.message);
    }
  }

  async _freshRadarImage() {
    if (!this._radarImage) return null;
    if (Date.now() - (this._radarUpdatedAt || 0) >= RADAR_IMAGE_MS) {
      this._radarUpdatedAt = Date.now();
      await this._radarImage.update().catch(this.error);
    }
    return this._radarImage;
  }

  _start() {
    this._stop();
    this._safe(this._setupRadarImage());
    this._pollTimer = this.homey.setInterval(() => this._safe(this.refresh()), POLL_MS);
    this._safe(this.refresh());
    if (this.getStoreValue('station')) {
      this._uploadTimer = this.homey.setInterval(() => this._safe(this._uploadOnce()), UPLOAD_MS);
    }
  }

  _stop() {
    if (this._radarImage) {
      this._radarImage.unregister().catch(this.error);
      this._radarImage = null;
    }
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
    const values = {
      ...capabilityValues(home, { timezone: this._tz() }), ...dailyCapabilityValues(home), ...comfortCapabilityValues(home),
      meteoveo_lightning_km: lightningCapability(home.lightning),
    };
    for (const [capability, value] of Object.entries(values)) {
      // null shows "no value" in Homey — the honest state when the service has
      // no reading; a zero would be a false measurement.
      if (this.hasCapability(capability)) await this.setCapabilityValue(capability, value).catch(this.error);
    }

    const now = Date.now();
    const rain = nextRainState(this.getStoreValue('rainState') || initialRainState(), home.nextHour, now);
    await this.setStoreValue('rainState', rain.state);
    const warnings = newWarnings(home.warnings, this.getStoreValue('seenWarnings') || [], now);
    // A fresh radar picture only when a trigger is about to carry it.
    const radar = rain.events.length || warnings.fresh.length ? await this._freshRadarImage() : this._radarImage || null;
    for (const event of rain.events) {
      if (event.type === 'rain_expected') {
        await this._trigger(event.type, {
          minutes: event.minutes ?? 0, intensity: this.homey.__(`intensity.${event.band || 'none'}`), radar,
        });
        if (this.getSetting('notify_rain') === true) {
          await this._notify(this.homey.__('notifications.rain', { place: this._placeName(), minutes: event.minutes ?? 0 }));
        }
      } else if (event.type === 'rain_started') {
        await this._trigger(event.type, { radar });
      } else if (event.type === 'rain_ending') {
        await this._trigger(event.type, { minutes: event.minutes ?? 0 });
      } else {
        await this._trigger(event.type, {});
      }
    }

    await this.setStoreValue('seenWarnings', warnings.seen);

    // Lightning (Plus): per storm, as it comes a ring (15/30/50 km) closer.
    const lightning = nextLightningState(this.getStoreValue('lightningState') || initialLightningState(), home.lightning);
    await this.setStoreValue('lightningState', lightning.state);
    for (const event of lightning.events) {
      await this._trigger('lightning_near', {
        distance: event.nearestKm ?? 0, direction: compass(event.bearingDeg, this._lang()), radar: await this._freshRadarImage(),
      }, { ring: event.ring });
    }
    for (const w of warnings.fresh) {
      await this._trigger('warning_issued', {
        level: this.homey.__(`levels.${w.level}`),
        phenomenon: w.phenomenonName || w.phenomenon || '',
        headline: w.headline || '',
        onset: this._when(w.onset),
        expires: this._when(w.expires),
        radar,
      });
      const notice = warningNotice(w, this.getSetting('notify_warnings') || 'orange', {
        levels: { yellow: this.homey.__('levels_lower.yellow'), orange: this.homey.__('levels_lower.orange'), red: this.homey.__('levels_lower.red') },
        template: this.homey.__('notifications.warning'),
      }, this._placeName(), this._when(w.expires));
      if (notice) await this._notify(notice);
    }

    // Highest-level transitions: changed / cleared. No history on the first poll.
    const level = values.meteoveo_warning;
    for (const event of levelTransition(this.getStoreValue('lastWarningLevel') ?? null, level)) {
      await this._trigger(event.type, event.type === 'warning_level_changed'
        ? { level: this.homey.__(`levels.${event.level}`), previous: this.homey.__(`levels.${event.previous}`) }
        : {});
    }
    await this.setStoreValue('lastWarningLevel', level);

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

  _placeName() {
    const place = this.getStoreValue('place');
    return (place && place.name) || this.getName();
  }

  _notify(excerpt) {
    return this.homey.notifications.createNotification({ excerpt }).catch(this.error);
  }

  /**
   * Homey's climate (zone and home temperature) averages every thermometer,
   * ours included — even in an outdoor zone, the home level counts it (seen on
   * the owner's Pro, 2026-10-24). Apps may not set `climate_exclude` (Web API:
   * "Missing Scopes"), so once per device, ten minutes after pairing (when the
   * user has picked the zone), we say how.
   */
  async _climateAdvice() {
    if (this.getStoreValue('climateAdviceDone')) return;
    await this._notify(this.homey.__('notifications.climate', { device: this.getName() }));
    await this.setStoreValue('climateAdviceDone', true);
  }

  /** A Build 1 device-mode station now takes its readings from Flow cards (ADR-0829, 2026-10-26). */
  async _upgradeStation() {
    const upgrade = upgradeStationStore({
      station: this.getStoreValue('station'), stationMode: this.getStoreValue('stationMode'),
    });
    if (!upgrade) return;
    await this.setStoreValue('stationMode', upgrade.stationMode);
    await this.setStoreValue('stationSources', null);
    await this.setStoreValue('dailyRain', null);
    if (upgrade.notify) await this._notify(this.homey.__('notifications.station_flow', { device: this.getName() }));
  }

  _trigger(cardId, tokens, state = {}) {
    return this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens, state).catch(this.error);
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

  async _ensureHome() {
    if (!this._home) await this.refresh({ force: true });
    return this._home;
  }

  async rainIntensityWithin(band, minutes) {
    const home = await this._ensureHome();
    const answer = rainIntensityWithin(home && home.nextHour, band, minutes, Date.now());
    if (answer === null) throw new Error(this.homey.__('errors.no_nowcast'));
    return answer;
  }

  async warningTypeActive(phenomenon, level) {
    const home = await this._ensureHome();
    return phenomenonActive(home && home.warnings, phenomenon, level);
  }

  async rainChanceAbove(day, percent) {
    const chance = precipChance(await this._ensureHome(), day);
    if (chance === null) throw new Error(this.homey.__('errors.no_forecast'));
    return chance > percent;
  }

  async gustWithin(speedKmh, hours) {
    const gust = maxGustWithin(await this._ensureHome(), hours, Date.now());
    if (gust === null) throw new Error(this.homey.__('errors.no_forecast'));
    return gust > speedKmh;
  }

  async sunnyNow() {
    const sunny = isSunny(await this._ensureHome());
    if (sunny === null) throw new Error(this.homey.__('errors.no_forecast'));
    return sunny;
  }

  async maxAbove(day, tempC) {
    const home = await this._ensureHome();
    const d = ((home && home.daily) || [])[day];
    if (!d || typeof d.tempMaxC !== 'number') throw new Error(this.homey.__('errors.no_forecast'));
    return d.tempMaxC > tempC;
  }

  async tropicalNightTonight() {
    const answer = tropicalNight(await this._ensureHome(), Date.now(), this._tz());
    if (answer === null) throw new Error(this.homey.__('errors.no_forecast'));
    return answer;
  }

  async coolerOutsideThan(indoorC, margin) {
    const answer = coolerOutside(await this._ensureHome(), Number(indoorC), Number(margin));
    if (answer === null) throw new Error(this.homey.__('errors.no_forecast'));
    return answer;
  }

  async lightningWithinRadius(radiusKm) {
    const answer = lightningWithin((await this._ensureHome() || {}).lightning, radiusKm);
    if (answer === 'locked') throw new Error(this.homey.__('errors.plus_required'));
    if (answer === null) throw new Error(this.homey.__('errors.no_lightning'));
    return answer;
  }

  async forecastTokens(day) {
    const words = {
      conditions: Object.fromEntries(ICON_KEYS.map((k) => [k, this.homey.__(`conditions.${k}`)])),
      days: [0, 1, 2].map((i) => this.homey.__(`forecast.day_${i}`)),
      sentence: this.homey.__('forecast.sentence'),
      unknown: this.homey.__('forecast.unknown'),
    };
    const tokens = dayForecast(await this._ensureHome(), day, words);
    if (!tokens) throw new Error(this.homey.__('errors.no_forecast'));
    return tokens;
  }

  // --- Station ----------------------------------------------------------------

  async report(measurement, value, unit) {
    if (!this.getStoreValue('station')) throw new Error(this.homey.__('errors.no_station'));
    this._readings[measurement] = { value: Number(value), unit, at: Date.now() };
  }

  async _uploadOnce() {
    const station = this.getStoreValue('station');
    if (!station) return;
    const now = Date.now();
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
      language: this.homey.i18n.getLanguage(),
      timezone: this._tz(),
      level: home.level,
      place: home.place,
      current: home.current,
      nextHour: home.nextHour,
      hourly: (home.hourly || []).slice(0, 12),
      daily: (home.daily || []).slice(0, 7),
      warnings: home.warnings || [],
      attribution: home.attribution,
    };
  }

  /**
   * Data for the radar widget (widgets/radar/api.js): the place and the frame
   * lists. The key stays on the Homey - the widget asks the app for the tiles.
   */
  async radarData(hours = 2) {
    const key = this.getStoreValue('key');
    if (!key) return { state: 'unavailable' };
    if (!this._home) await this.refresh({ force: true }).catch(() => {});
    const place = this._home && this._home.place;
    if (!place) return { state: this.getAvailable() ? 'loading' : 'unavailable' };
    try {
      const lists = await this.homey.app.client.radarFrames(key, hours);
      return {
        state: 'ok',
        name: this.getName(),
        language: this.homey.i18n.getLanguage(),
        timezone: this._tz(),
        place,
        lat: place.lat,
        lon: place.lon,
        ...lists,
      };
    } catch (err) {
      this.error('radar frames', err.message);
      return { state: 'unavailable' };
    }
  }

  /** The device's key for the app's radar-tile proxy; null when the device has none. */
  radarKey() {
    return this.getStoreValue('key') || null;
  }

  // --- Lifecycle -------------------------------------------------------------

  async onDeleted() {
    if (this._adviceTimer) this.homey.clearTimeout(this._adviceTimer);
    this._stop();
    const key = this.getStoreValue('key');
    // Removing the device revokes only this key; the account, the station and
    // its measurements stay. A network failure must not block the removal.
    if (key) await this.homey.app.client.revokeKey(key).catch(this.error);
  }

  async onUninit() {
    if (this._adviceTimer) this.homey.clearTimeout(this._adviceTimer);
    this._stop();
  }
}

module.exports = MeteoVeoDevice;
