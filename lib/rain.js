'use strict';

/**
 * Rain episodes for the Flow triggers.
 *
 * A trigger that fires on every flip of the forecast would close the awning
 * five times in a drizzle, and users switch such an app off. The state machine
 * therefore fires on episodes, not on samples:
 *
 *   dry ──rainSoon──▶ expected ──rainNow──▶ raining ──2 dry polls──▶ dry
 *    └───────────────rainNow────────────────▲
 *
 * - `rain_expected` fires once when the forecast first shows rain coming, and
 *   not again within EXPECTED_COOLDOWN_MS if the forecast wavers.
 * - `rain_started` fires on entering `raining`, from either state.
 * - `rain_stopped` needs STOP_CONFIRM_POLLS dry polls in a row: one dry
 *   radar frame inside a shower is not the end of it.
 *
 * The state is plain JSON, because it lives in the device store and has to
 * survive an app restart without re-firing.
 */

const EXPECTED_COOLDOWN_MS = 30 * 60_000;
const STOP_CONFIRM_POLLS = 2;

function initialRainState() {
  return { phase: 'dry', lastExpectedAt: null, dryPolls: 0 };
}

function minutesUntil(iso, now) {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - now) / 60_000));
}

function nextRainState(previous, nextHour, now) {
  const state = { ...initialRainState(), ...previous };
  const events = [];

  // No coverage (outside the radar composite, or the nowcast is down): keep
  // what we knew. Inventing a stop here would fire a false "rain stopped".
  if (!nextHour) return { state, events };

  if (nextHour.rainNow) {
    if (state.phase !== 'raining') events.push({ type: 'rain_started' });
    state.phase = 'raining';
    state.dryPolls = 0;
    return { state, events };
  }

  if (state.phase === 'raining') {
    state.dryPolls += 1;
    if (state.dryPolls >= STOP_CONFIRM_POLLS) {
      events.push({ type: 'rain_stopped' });
      state.phase = 'dry';
      state.dryPolls = 0;
    }
    return { state, events };
  }

  if (nextHour.rainSoon) {
    if (state.phase === 'dry') {
      const cooled = state.lastExpectedAt == null || now - state.lastExpectedAt >= EXPECTED_COOLDOWN_MS;
      if (cooled) {
        events.push({ type: 'rain_expected', minutes: minutesUntil(nextHour.rainStartsAt, now) });
        state.lastExpectedAt = now;
      }
      state.phase = 'expected';
    }
    return { state, events };
  }

  state.phase = 'dry';
  return { state, events };
}

const STEP_MS = 10 * 60_000;

/**
 * Will it rain within `minutes` from `now`? Uses each step's own time, not
 * `leadMinutes`: the lead counts from when the server computed the response,
 * and a response kept after a 304 is several minutes older than that.
 * A step covers [at, at + 10 min). null = no next-hour data (unknown).
 */
function rainWithinMinutes(nextHour, minutes, now) {
  const steps = nextHour && Array.isArray(nextHour.steps) ? nextHour.steps : [];
  if (!steps.length) return null;
  const horizon = now + minutes * 60_000;
  return steps.some((s) => {
    const start = Date.parse(s.at);
    if (Number.isNaN(start) || !s.band || s.band === 'none') return false;
    return start + STEP_MS > now && start <= horizon;
  });
}

module.exports = {
  initialRainState, nextRainState, rainWithinMinutes, EXPECTED_COOLDOWN_MS, STOP_CONFIRM_POLLS,
};
