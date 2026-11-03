// What the crew feed view draws (B3): friends' finished workouts and consistency, only as each friend shares them. No weights, reps or notes.
export interface CrewPerson {
  /** A friend is shown by nickname when they have one (then no email), else by email. */
  nickname: string | null;
  email: string | null;
}

export interface CrewWorkout {
  /** The workout's id: what give_kudos takes. */
  id: string;
  who: CrewPerson;
  day: string;
  type: 'strength' | 'cardio' | 'session';
  /** The friend's own name for it, or the kind of workout. Text from another person, cleaned. */
  title: string;
  /** Strength: up to 4 exercise names and how many exercises in all. */
  exercises: string[];
  exerciseCount: number;
  /** Strength: sets done. */
  sets: number;
  minutes: number | null;
  kudos: { count: number; mine: boolean };
  /** Exercises of this workout where the friend beat their own earlier best (names only, no numbers). */
  records: string[];
}

export interface CrewConsistency {
  trainingWeeks: { current: number; best: number; atLeast: boolean } | null;
  loggingDays: { current: number; best: number; atLeast: boolean };
  loggingWeeks: { current: number; best: number; atLeast: boolean };
}

export interface CrewFriend {
  who: CrewPerson;
  /** Present only for a friend who shares consistency with this person. */
  consistency: CrewConsistency | null;
}

export interface CrewFeed {
  /** The last days shown. */
  from: string;
  to: string;
  friends: CrewFriend[];
  workouts: CrewWorkout[];
  /** This person's own recent workouts that friends gave kudos to, with who. */
  yours: { id: string; day: string; title: string; from: CrewPerson[] }[];
}
