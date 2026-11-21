// Builds a roster for one schedule.
//
// This is the part a spreadsheet can't do. The hard rules can never be broken;
// the soft ones decide who gets picked when several people are eligible.
//
//   Hard   - not if they marked themselves unavailable
//          - never two shifts in one day
//          - a day off after a night shift (a night ends at 06:00, so the
//            next morning is physically impossible anyway)
//          - no more than MAX_SHIFTS in the period
//
//   Soft   - whoever has fewest shifts so far goes first
//          - nights are counted separately, so the same people don't absorb
//            all of them
//          - working several days straight is penalised
//          - someone who marked the day "preferred" gets a nudge up
//
// Shifts are filled in date order. Greedy rather than a full constraint
// solver: it isn't guaranteed optimal, but it runs instantly and the result
// is close enough that the gaps it reports are real gaps, not bad packing.

const MAX_SHIFTS = 5;

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function generateRoster({ shifts, staff, unavailable, preferred }) {
  // How each person is doing so far. Rebuilt from scratch every run, so
  // regenerating a schedule always gives a consistent result.
  const stats = new Map(
    staff.map((person) => [person.id, {
      id: person.id,
      name: person.name,
      total: 0,
      nights: 0,
      days: new Set(),        // dates they are already working
      lastDate: null,
      streak: 0
    }])
  );

  const assignments = [];
  const gaps = [];

  // Date order matters: "did they work yesterday" is only knowable if
  // yesterday has already been filled.
  const ordered = [...shifts].sort((a, b) =>
    a.date === b.date ? a.shift_type_id - b.shift_type_id : a.date.localeCompare(b.date)
  );

  for (const shift of ordered) {
    const isNight = shift.shift_name === 'Night';
    const yesterday = addDays(shift.date, -1);

    const eligible = [];
    for (const person of stats.values()) {
      if (unavailable.has(`${person.id}|${shift.date}`)) continue;
      if (person.days.has(shift.date)) continue;
      if (person.nightDates && person.nightDates.has(yesterday)) continue;
      if (person.total >= MAX_SHIFTS) continue;
      eligible.push(person);
    }

    const picked = eligible
      .map((person) => ({ person, score: scoreOf(person, shift, isNight, yesterday, preferred) }))
      .sort((a, b) => a.score - b.score)
      .slice(0, shift.required_staff)
      .map((entry) => entry.person);

    for (const person of picked) {
      assignments.push({ shift_id: shift.id, user_id: person.id });

      person.total += 1;
      person.days.add(shift.date);
      if (isNight) {
        person.nights += 1;
        person.nightDates = person.nightDates || new Set();
        person.nightDates.add(shift.date);
      }
      person.streak = person.lastDate === yesterday ? person.streak + 1 : 1;
      person.lastDate = shift.date;
    }

    // Say so rather than quietly producing a roster that doesn't cover the day
    if (picked.length < shift.required_staff) {
      gaps.push({
        date: shift.date,
        shift: shift.shift_name,
        needed: shift.required_staff,
        filled: picked.length
      });
    }
  }

  return {
    assignments,
    gaps,
    fairness: summarise(stats)
  };
}

function scoreOf(person, shift, isNight, yesterday, preferred) {
  // Lower wins. Total shifts dominates, so the roster stays even overall;
  // the rest only break ties.
  let score = person.total * 100;

  if (isNight) score += person.nights * 60;
  if (person.lastDate === yesterday) score += person.streak * 15;
  if (preferred.has(`${person.id}|${shift.date}`)) score -= 40;

  // Without this, ties always resolve the same way and the same few names
  // end up at the top of every shift.
  score += Math.random() * 10;

  return score;
}

function summarise(stats) {
  const people = [...stats.values()].map((p) => ({
    id: p.id, name: p.name, total: p.total, nights: p.nights
  }));

  const totals = people.map((p) => p.total);
  const nights = people.map((p) => p.nights);

  return {
    people: people.sort((a, b) => b.total - a.total || b.nights - a.nights),
    spread: {
      minShifts: Math.min(...totals),
      maxShifts: Math.max(...totals),
      minNights: Math.min(...nights),
      maxNights: Math.max(...nights)
    }
  };
}
