// Finnish time (EET, UTC+2) — challenge runs November 3 00:00 to January 1 00:00
export const CHALLENGE_START = new Date('2026-11-03T00:00:00+02:00');
export const CHALLENGE_END = new Date('2027-01-01T00:00:00+02:00');

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
};
