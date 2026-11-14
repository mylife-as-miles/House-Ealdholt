/**
 * My Legacy's observer (the creator's direction of 10 November 2026): the player is an unseen presence over House
 * Ealdholt who watches the village live its own life and can reach in to change it. These are the observer's powers
 * over time and the sky. They layer over the village's own clock and weather; they never rewrite the population save.
 *
 * Time: the observed clock runs at the chosen speed from the moment it was last set. Pause holds it, fast runs it
 * ahead. What the observer has done to time is kept as an offset from the village's own clock and saved with it.
 */

/** Paused, as lived, and two faster speeds. */
export const OBSERVER_SPEEDS = [0, 1, 4, 16] as const;
export type ObserverSpeed = (typeof OBSERVER_SPEEDS)[number];

export interface ObserverClock {
  readonly speed: ObserverSpeed;
  /** Observed simulated milliseconds when the speed was last set. */
  readonly anchorObserved: number;
  /** Real milliseconds (a monotonic clock) when the speed was last set. */
  readonly anchorReal: number;
}

export function isObserverSpeed(value: unknown): value is ObserverSpeed {
  return OBSERVER_SPEEDS.includes(value as ObserverSpeed);
}

/** Starts the observed clock over the village's own, carrying the offset the observer left last time. */
export function startObserverClock(storeMilliseconds: number, savedOffsetMilliseconds: number, realNow: number,
  speed: ObserverSpeed = 1): ObserverClock {
  const offset = Number.isFinite(savedOffsetMilliseconds) ? savedOffsetMilliseconds : 0;
  return { speed, anchorObserved: Math.max(0, storeMilliseconds + offset), anchorReal: realNow };
}

/** The observed simulated time, in whole milliseconds as the population runtime requires. */
export function observedMilliseconds(clock: ObserverClock, realNow: number): number {
  return Math.max(0, Math.round(clock.anchorObserved + clock.speed * Math.max(0, realNow - clock.anchorReal)));
}

export function setObserverSpeed(clock: ObserverClock, speed: ObserverSpeed, realNow: number): ObserverClock {
  if (speed === clock.speed) return clock;
  return { speed, anchorObserved: observedMilliseconds(clock, realNow), anchorReal: realNow };
}

/** What to save: how far the observed clock stands from the village's own. */
export function observerOffset(clock: ObserverClock, storeMilliseconds: number, realNow: number): number {
  return observedMilliseconds(clock, realNow) - storeMilliseconds;
}

// ---------------------------------------------------------------------- the sky

export type ObserverWeather = "clear" | "overcast" | "rain" | "storm";
export const OBSERVER_WEATHERS: readonly ObserverWeather[] = ["clear", "overcast", "rain", "storm"];
/** A command over the sky lasts four village hours, then the weather goes its own way again. */
export const OBSERVER_WEATHER_MINUTES = 240;

export interface ObserverWeatherCommand {
  readonly kind: ObserverWeather;
  /** Absolute observed world minute when the sky is given back. */
  readonly untilMinute: number;
}

/** The shape world-environment-state.ts accepts in place of its own seeded weather. */
export interface ObserverEnvironmentOverride {
  readonly weather: "clear" | "overcast" | "rain";
  readonly cloudCoverage?: number;
  readonly rain?: number;
  readonly windStrength?: number;
}

export function isObserverWeather(value: unknown): value is ObserverWeather {
  return OBSERVER_WEATHERS.includes(value as ObserverWeather);
}

export function commandWeather(kind: ObserverWeather, absoluteMinute: number): ObserverWeatherCommand {
  return { kind, untilMinute: absoluteMinute + OBSERVER_WEATHER_MINUTES };
}

/** The live command, or null once it has run out. */
export function activeWeather(command: ObserverWeatherCommand | null, absoluteMinute: number): ObserverWeatherCommand | null {
  return command && absoluteMinute < command.untilMinute ? command : null;
}

export function weatherOverride(command: ObserverWeatherCommand | null, absoluteMinute: number): ObserverEnvironmentOverride | undefined {
  const live = activeWeather(command, absoluteMinute);
  if (!live) return undefined;
  switch (live.kind) {
    case "clear": return { weather: "clear" };
    case "overcast": return { weather: "overcast" };
    case "rain": return { weather: "rain", rain: 0.85, cloudCoverage: 0.91 };
    // A storm is the heaviest rain the sky can hold, under a closed lid of cloud, with the wind up.
    case "storm": return { weather: "rain", rain: 1, cloudCoverage: 0.98, windStrength: 1 };
  }
}
