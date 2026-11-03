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

export const CATEGORY_ORDER = ['Running', 'Walking', 'Cycling', 'Winter Sports', 'Water Sports', 'Gym & Fitness', 'Other'];

export function categoryOf(sportType: string | null | undefined): string {
  return ACTIVITY_CATEGORIES[sportType ?? ''] ?? 'Other';
}
