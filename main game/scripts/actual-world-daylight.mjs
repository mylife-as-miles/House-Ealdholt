// Read-only inspection timing. Actual time changes still use visible controls.
export function actualWorldDaylight(environment) {
  return Number.isFinite(environment?.daylight) && environment.daylight > .95;
}

export function daylightInspectionTiming(environment, observation) {
  const { day, hour, minute, cloudMotionSeconds } = environment ?? {};
  if (![day,hour,minute,cloudMotionSeconds].every(Number.isFinite)
    || !Number.isInteger(day) || day < 0 || hour < 0 || hour >= 24 || minute < 0 || minute >= 60) {
    throw Error('Daylight inspection needs the actual world clock.');
  }
  const absoluteMinute = day * 1440 + hour * 60 + minute;
  // The normal-motion uniform is absolute world minutes times the saved pace,
  // in seconds. Displayed minutes omit only their fractional part.
  const reportedPace=observation?.millisecondsPerWorldMinute;
  const secondsPerWorldMinute = reportedPace === undefined ? cloudMotionSeconds / absoluteMinute : reportedPace / 1000;
  if (!Number.isFinite(secondsPerWorldMinute) || secondsPerWorldMinute <= 0 || secondsPerWorldMinute > 3600) {
    throw Error('Daylight inspection needs an advancing observed clock pace.');
  }
  const pending=observation?.pendingMilliseconds??0;
  if (!Number.isFinite(pending) || pending < 0) throw Error('Invalid resident observation backlog.');
  if (pending > secondsPerWorldMinute*1000*60) {
    throw Error('Resident observation is over one world hour behind; daylight inspection must wait for simulation catch-up before accelerating.');
  }
  // Keep roughly four world minutes per real second for either common pace.
  // This leaves a morning window despite a slow software frame/command queue.
  const speed = secondsPerWorldMinute >= 3 ? 16 : 4;
  const minutesToMorning = (480 - (hour * 60 + minute) + 1440) % 1440;
  const forecastMilliseconds = minutesToMorning * secondsPerWorldMinute / speed * 1000;
  const timeout = Math.min(600000, Math.max(180000, Math.ceil(forecastMilliseconds) + 120000));
  return { speed, secondsPerWorldMinute, minutesToMorning, timeout, actionTimeout:60000, cleanupReserve:200000,
    paceSource:reportedPace===undefined?'environment-animation-clock':'reported-population-clock',pendingWorldMinutes:pending/(secondsPerWorldMinute*1000) };
}

export function daylightInspectionWorkDeadline(timing, now, captureDeadline) {
  if (![timing?.timeout,timing?.actionTimeout,timing?.cleanupReserve,now,captureDeadline].every(Number.isFinite)
    || timing.timeout <= 0 || timing.actionTimeout <= 0 || timing.cleanupReserve < timing.actionTimeout
    || now + timing.timeout + timing.actionTimeout + timing.cleanupReserve >= captureDeadline) {
    throw Error('Reserve time for acceleration dispatch, morning reads and normal-speed restoration before inspecting daylight.');
  }
  return captureDeadline - timing.cleanupReserve;
}
