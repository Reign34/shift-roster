// The shapes the rest of the app passes around. Having them in one file
// means a column added to the database is a change in one place, and
// everything that reads it stops compiling until it's handled.

export type Role = 'staff' | 'manager';

export type ShiftName = 'Morning' | 'Afternoon' | 'Night';

// A typo like 'Nigth' now fails to compile instead of quietly never matching
export type AvailabilityStatus = 'unavailable' | 'preferred';

export type ScheduleStatus = 'draft' | 'published';

export type SwapStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export type User = {
  id: number;
  name: string;
  email: string;
  role: Role;
  created_at?: string;
};

// Separate from User on purpose: the hash exists in the database but must
// never reach a response, and keeping it off User makes that a type error
// rather than something to remember.
export type UserRow = User & { password_hash: string };

export type Schedule = {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  status: ScheduleStatus;
  created_by: number;
  created_at: string;
};

export type Shift = {
  id: number;
  date: string;
  shift_type_id: number;
  shift_name: ShiftName;
  required_staff: number;
};

export type StaffMember = Pick<User, 'id' | 'name'>;

export type Assignment = {
  shift_id: number;
  user_id: number;
};

export type GeneratorInput = {
  shifts: Shift[];
  staff: StaffMember[];
  // Keyed "userId|date" so a lookup is one Set hit rather than a scan
  unavailable: Set<string>;
  preferred: Set<string>;
};

export type Gap = {
  date: string;
  shift: ShiftName;
  needed: number;
  filled: number;
};

export type FairnessEntry = {
  id: number;
  name: string;
  total: number;
  nights: number;
};

export type Fairness = {
  people: FairnessEntry[];
  spread: {
    minShifts: number;
    maxShifts: number;
    minNights: number;
    maxNights: number;
  };
};

export type GeneratorResult = {
  assignments: Assignment[];
  gaps: Gap[];
  fairness: Fairness;
};

// What the generator tracks per person while it runs
export type PersonState = {
  id: number;
  name: string;
  total: number;
  nights: number;
  days: Set<string>;
  nightDates: Set<string>;
  lastDate: string | null;
  streak: number;
};
