import { sql } from './db.js'
// A `date` column arrives as a Date object, and String()ing one yields "Sat Aug 14"
// rather than an ISO day — the same trap blood.js hit.
import { databaseDateKey } from './neon-dashboard.js'

// Lifetime distance, for the Journeys screen. One aggregate over health_daily — every
// day Fuel has ever recorded, not the 30-day window the dashboard reads — because the
// whole point is the number that only means something after years of it.
//
// Walking and running arrive as a single daily figure from HealthKit and are reported
// that way rather than split on a guess. The workouts table can tell a run from a walk,
// but it only holds sessions someone explicitly recorded, which is a small fraction of
// the distance a person actually covers; pretending that fraction is the whole would
// make the headline number wrong by an order of magnitude.

export async function getJourneyTotals(userId) {
  const db = sql()
  const [row] = await db`
    SELECT
      COALESCE(SUM(walking_running_distance_mi), 0)::float AS walk_run_miles,
      COALESCE(SUM(cycling_distance_mi), 0)::float          AS cycling_miles,
      COALESCE(SUM(swimming_distance_yd), 0)::float         AS swimming_yards,
      COALESCE(SUM(step_count), 0)::float                   AS steps,
      COALESCE(SUM(flights_climbed), 0)::float              AS flights,
      MIN(date)                                             AS first_day,
      COUNT(*)::int                                         AS days
    FROM health_daily
    WHERE user_id = ${userId}
  `
  return {
    walkRunMiles: row?.walk_run_miles ?? 0,
    cyclingMiles: row?.cycling_miles ?? 0,
    // Converted here so every distance the client handles is in one unit.
    swimmingMiles: (row?.swimming_yards ?? 0) / 1760,
    steps: row?.steps ?? 0,
    flights: row?.flights ?? 0,
    firstDay: row?.first_day ? databaseDateKey(row.first_day) || null : null,
    days: row?.days ?? 0,
  }
}
