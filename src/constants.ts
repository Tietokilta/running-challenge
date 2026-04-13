// Finnish time (EEST, UTC+3) — challenge runs April 1 00:00 to June 1 00:00
export const CHALLENGE_START = new Date('2026-04-01T00:00:00+03:00');
export const CHALLENGE_END = new Date('2026-06-01T00:00:00+03:00');

export const ACTIVITY_CATEGORIES: Record<string, string> = {
  // Running
  Run: 'Running',
  VirtualRun: 'Running',
  TrailRun: 'Running',
  // Walking
  Walk: 'Walking',
  Hike: 'Walking',
  Snowshoe: 'Walking',
  // Cycling
  Ride: 'Cycling',
  VirtualRide: 'Cycling',
  EBikeRide: 'Cycling',
  GravelRide: 'Cycling',
  MountainBikeRide: 'Cycling',
  EMountainBikeRide: 'Cycling',
  Handcycle: 'Cycling',
  Velomobile: 'Cycling',
  // Winter Sports
  NordicSki: 'Winter Sports',
  AlpineSki: 'Winter Sports',
  BackcountrySki: 'Winter Sports',
  Snowboard: 'Winter Sports',
  IceSkate: 'Winter Sports',
  // Water Sports
  Swim: 'Water Sports',
  Rowing: 'Water Sports',
  VirtualRow: 'Water Sports',
  Canoeing: 'Water Sports',
  Kayaking: 'Water Sports',
  Sail: 'Water Sports',
  StandUpPaddling: 'Water Sports',
  Surfing: 'Water Sports',
  Kitesurf: 'Water Sports',
  Windsurf: 'Water Sports',
  // Gym & Fitness
  WeightTraining: 'Gym & Fitness',
  Crossfit: 'Gym & Fitness',
  HighIntensityIntervalTraining: 'Gym & Fitness',
  Workout: 'Gym & Fitness',
  Yoga: 'Gym & Fitness',
  Pilates: 'Gym & Fitness',
  Elliptical: 'Gym & Fitness',
  StairStepper: 'Gym & Fitness',
  RockClimbing: 'Gym & Fitness',
};
