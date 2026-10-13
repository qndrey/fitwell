/** Energy for an activity: MET × body weight (kg) × hours. Returns whole kcal, or undefined when it cannot be estimated. */
export function estimateKcal(met: number, weightKg: number | undefined, durationMin: number): number | undefined {
  if (!weightKg || weightKg <= 0 || !(met > 0) || !(durationMin > 0)) return undefined;
  return Math.round(met * weightKg * (durationMin / 60));
}

/** The weight used for estimates: the most recent logged weight, else the one set in Settings, else none (no estimate). */
export function bodyWeightKg(latestLoggedKg: number | undefined, settingsFallbackKg: number | undefined): number | undefined {
  return latestLoggedKg ?? settingsFallbackKg;
}
