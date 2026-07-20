// US retail calendar resolver — pure module.
//
// Given a `year`, resolves the concrete anchor date for a seasonal_calendar_seed
// row. Handles both fixed_date entries (Halloween 10-31, Valentine's 2-14) and
// moving US holidays via lightweight formulas — no external library.

export type SeasonRule =
  | {
      kind: "fixed_date";
      month: number;
      day: number;
    }
  | {
      kind: "us_holiday";
      tag: string;
    };

/** Resolve the anchor date for a season in a given year (UTC). */
export function resolveSeasonAnchor(rule: SeasonRule, year: number): Date | null {
  if (rule.kind === "fixed_date") {
    return utc(year, rule.month, rule.day);
  }
  switch (rule.tag) {
    case "easter_us":
      return computusGregorian(year);
    case "mothers_day_us":
      // 2nd Sunday of May
      return nthWeekdayOfMonth(year, 5, 0, 2);
    case "fathers_day_us":
      // 3rd Sunday of June
      return nthWeekdayOfMonth(year, 6, 0, 3);
    case "thanksgiving_us":
      // 4th Thursday of November
      return nthWeekdayOfMonth(year, 11, 4, 4);
    case "black_friday_us": {
      const t = nthWeekdayOfMonth(year, 11, 4, 4);
      return t ? utc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate() + 1) : null;
    }
    case "cyber_monday_us": {
      const t = nthWeekdayOfMonth(year, 11, 4, 4);
      return t ? utc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate() + 4) : null;
    }
    default:
      return null;
  }
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

/** n-th weekday (0=Sun) of month (1-12) in year, UTC. */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + shift + (n - 1) * 7;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Anonymous Gregorian computus for Easter. */
function computusGregorian(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
