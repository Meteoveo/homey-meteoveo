'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectStation } = require('../lib/station-detect');

const cand = (deviceId, name, zone, capability, driverId = 'homey:app:com.example:thing') => ({
  deviceId, name, zone, capability, driverId, value: 1, units: '',
});

test('a device from a weather-station app is picked for every measurement it has', () => {
  const ecowitt = 'homey:app:com.ecowitt:gateway';
  const candidates = {
    temperature: [cand('thermo', 'Termostato', 'Salón', 'measure_temperature'), cand('eco', 'Estación', 'Jardín', 'measure_temperature', ecowitt)],
    humidity: [cand('eco', 'Estación', 'Jardín', 'measure_humidity', ecowitt)],
    pressure: [cand('eco', 'Estación', 'Jardín', 'measure_pressure', ecowitt)],
    wind_speed: [],
  };
  const result = detectStation(candidates);
  assert.deepEqual(result.station, { deviceId: 'eco', name: 'Estación', zone: 'Jardín' });
  assert.deepEqual(result.preselect, {
    temperature: { deviceId: 'eco', capability: 'measure_temperature' },
    humidity: { deviceId: 'eco', capability: 'measure_humidity' },
    pressure: { deviceId: 'eco', capability: 'measure_pressure' },
  });
});

test('an indoor thermostat alone is never taken for a station', () => {
  const result = detectStation({
    temperature: [cand('thermo', 'Termostato', 'Salón', 'measure_temperature')],
    humidity: [cand('thermo', 'Termostato', 'Salón', 'measure_humidity')],
  });
  assert.equal(result.station, null);
  assert.deepEqual(result.preselect, {});
});

test('an outdoor multi-sensor without a known app counts when it measures enough', () => {
  const result = detectStation({
    temperature: [cand('out', 'Sensor exterior', 'Terraza', 'measure_temperature')],
    humidity: [cand('out', 'Sensor exterior', 'Terraza', 'measure_humidity')],
    pressure: [cand('out', 'Sensor exterior', 'Terraza', 'measure_pressure')],
  });
  assert.equal(result.station.deviceId, 'out');
});

test('a gap in the station is filled only from another weather-station app device', () => {
  const tempest = 'homey:app:com.weatherflow.tempest:hub';
  const netatmo = 'homey:app:com.netatmo:outdoor';
  const result = detectStation({
    temperature: [cand('nt', 'Netatmo exterior', 'Jardín', 'measure_temperature', netatmo)],
    humidity: [cand('nt', 'Netatmo exterior', 'Jardín', 'measure_humidity', netatmo)],
    wind_speed: [cand('fan', 'Ventilador', 'Dormitorio', 'measure_wind_strength'), cand('tp', 'Tempest', 'Tejado', 'measure_wind_strength', tempest)],
  });
  assert.equal(result.station.deviceId, 'nt');
  assert.deepEqual(result.preselect.wind_speed, { deviceId: 'tp', capability: 'measure_wind_strength' });
});

test('no candidates, no station', () => {
  assert.deepEqual(detectStation({}), { station: null, preselect: {} });
  assert.deepEqual(detectStation(undefined), { station: null, preselect: {} });
});
