import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoster } from '../src/generator.js';

// The generator is a pure function: shifts and people in, assignments out,
// no database. That makes it the easiest thing in the project to test
// properly and the most important, because a scheduling bug is invisible
// until someone turns up for a shift that isn't theirs.

const SHIFT_NAMES = ['Morning', 'Afternoon', 'Night'];

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildShifts({ start = '2026-01-05', days = 7, requiredStaff = 7 } = {}) {
  const shifts = [];
  let id = 1;
  for (let d = 0; d < days; d++) {
    const date = addDays(start, d);
    SHIFT_NAMES.forEach((shift_name, i) => {
      shifts.push({ id: id++, date, shift_type_id: i + 1, shift_name, required_staff: requiredStaff });
    });
  }
  return shifts;
}

function buildStaff(count = 33) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Person ${i + 1}` }));
}

function run(options = {}) {
  const shifts = options.shifts || buildShifts(options);
  const staff = options.staff || buildStaff(options.staffCount);
  const result = generateRoster({
    shifts,
    staff,
    unavailable: options.unavailable || new Set(),
    preferred: options.preferred || new Set()
  });
  return { shifts, staff, ...result };
}

// Turns the flat assignment list into something the assertions can ask
// questions of: what is each person working, and on which dates.
function byPerson({ assignments, shifts }) {
  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const map = new Map();
  for (const a of assignments) {
    if (!map.has(a.user_id)) map.set(a.user_id, []);
    map.get(a.user_id).push(shiftById.get(a.shift_id));
  }
  return map;
}

describe('hard rules', () => {
  test('nobody is assigned on a day they marked unavailable', () => {
    const unavailable = new Set();
    for (const date of ['2026-01-06', '2026-01-07', '2026-01-08']) {
      for (const id of [1, 2, 3, 4, 5]) unavailable.add(`${id}|${date}`);
    }

    const result = run({ unavailable });

    for (const a of result.assignments) {
      const shift = result.shifts.find((s) => s.id === a.shift_id);
      assert.ok(
        !unavailable.has(`${a.user_id}|${shift.date}`),
        `person ${a.user_id} was assigned on ${shift.date} despite being unavailable`
      );
    }
  });

  test('nobody works two shifts on the same day', () => {
    const result = run();

    for (const [userId, shifts] of byPerson(result)) {
      const dates = shifts.map((s) => s.date);
      assert.equal(
        new Set(dates).size, dates.length,
        `person ${userId} has two shifts on one day`
      );
    }
  });

  test('a night shift is always followed by a day off', () => {
    // Deliberately tight: 7 people covering 2 per shift, every slot, all
    // week. With the full 33 there is so much slack that nobody is ever
    // needed the day after a night, so the rule never gets exercised and
    // this test passes even with the rule deleted from the generator.
    // Checked by deleting it: this scenario produces 5 violations without
    // the rule and none with it.
    const result = run({ staffCount: 7, requiredStaff: 2 });

    assert.ok(result.assignments.length > 30, 'scenario should put the roster under real pressure');

    for (const [userId, shifts] of byPerson(result)) {
      const working = new Set(shifts.map((s) => s.date));
      for (const shift of shifts) {
        if (shift.shift_name !== 'Night') continue;
        assert.ok(
          !working.has(addDays(shift.date, 1)),
          `person ${userId} worked a night on ${shift.date} and again the next day`
        );
      }
    }
  });

  test('nobody exceeds five shifts', () => {
    const result = run();

    for (const [userId, shifts] of byPerson(result)) {
      assert.ok(shifts.length <= 5, `person ${userId} has ${shifts.length} shifts`);
    }
  });
});

describe('fairness', () => {
  test('shift counts differ by at most one across the team', () => {
    const { fairness } = run();
    const gap = fairness.spread.maxShifts - fairness.spread.minShifts;
    assert.ok(gap <= 1, `shift spread was ${gap}, expected 1 or less`);
  });

  test('nights are spread rather than landing on the same few people', () => {
    const { fairness } = run();
    const gap = fairness.spread.maxNights - fairness.spread.minNights;
    assert.ok(gap <= 2, `night spread was ${gap}, expected 2 or less`);
  });

  test('a preferred day makes a person more likely to be picked for it', () => {
    // One person prefers every day; over a full week they should come out
    // at or above the average rather than being passed over.
    const preferred = new Set();
    for (let d = 0; d < 7; d++) preferred.add(`1|${addDays('2026-01-05', d)}`);

    const result = run({ preferred });
    const mine = byPerson(result).get(1)?.length ?? 0;

    assert.ok(mine >= 4, `preferred person got only ${mine} shifts`);
  });
});

describe('coverage', () => {
  test('a full week with 33 staff is completely covered', () => {
    const result = run();

    assert.equal(result.gaps.length, 0, 'expected no gaps');
    assert.equal(result.assignments.length, 21 * 7, 'expected every slot filled');
  });

  test('shortfalls are reported rather than silently left empty', () => {
    // Six people cannot cover 21 shifts of 7
    const result = run({ staffCount: 6 });

    assert.ok(result.gaps.length > 0, 'expected gaps to be reported');

    for (const gap of result.gaps) {
      assert.ok(gap.filled < gap.needed);
      assert.ok(gap.date && gap.shift);
    }
  });

  test('never assigns more people than a shift asked for', () => {
    const result = run({ requiredStaff: 3 });

    const perShift = new Map();
    for (const a of result.assignments) {
      perShift.set(a.shift_id, (perShift.get(a.shift_id) || 0) + 1);
    }
    for (const [shiftId, count] of perShift) {
      assert.ok(count <= 3, `shift ${shiftId} has ${count} people, limit was 3`);
    }
  });
});

describe('edge cases', () => {
  test('no staff produces no assignments and reports every shift as a gap', () => {
    const result = run({ staff: [] });

    assert.equal(result.assignments.length, 0);
    assert.equal(result.gaps.length, 21);
  });

  test('everyone unavailable every day leaves the roster empty, not broken', () => {
    const unavailable = new Set();
    for (let id = 1; id <= 33; id++) {
      for (let d = 0; d < 7; d++) unavailable.add(`${id}|${addDays('2026-01-05', d)}`);
    }

    const result = run({ unavailable });

    assert.equal(result.assignments.length, 0);
    assert.equal(result.gaps.length, 21);
  });

  test('a single day schedule works', () => {
    const result = run({ days: 1 });

    assert.equal(result.assignments.length, 3 * 7);
    assert.equal(result.gaps.length, 0);
  });

  test('running it twice does not accumulate state between runs', () => {
    const first = run();
    const second = run();

    assert.equal(first.assignments.length, second.assignments.length);
    assert.equal(first.fairness.spread.maxShifts, second.fairness.spread.maxShifts);
  });
});
