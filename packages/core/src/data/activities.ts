/**
 * Cardio and everyday activities with MET values (metabolic equivalent of task).
 * Hand-assembled, rounded values for common activities, following the published tables of the
 * Compendium of Physical Activities (Ainsworth et al., Med Sci Sports Exerc 2011; https://pacompendium.com).
 * Not a copy of the Compendium. Treat them as estimates: real energy use varies from person to person.
 * Permission from the Compendium maintainers for a larger import is still to be requested (see TECH_SPEC).
 * Ids are stable: "act:<slug>". Never reuse an id for a different activity.
 */
/** Whole-body sessions that are logged with log_session instead of log_cardio. */
export const SESSION_CATEGORIES = ['pilates', 'yoga', 'hiit', 'crossfit', 'hyrox', 'functional'] as const;
export type SessionCategory = (typeof SESSION_CATEGORIES)[number];

export interface Activity {
  id: string;
  name: string;
  met: number;
  group: string;
  /** Set for activities that are whole-body sessions rather than cardio. */
  category?: SessionCategory;
}

const a = (slug: string, name: string, met: number, group: string, category?: SessionCategory): Activity => ({ id: `act:${slug}`, name, met, group, ...(category ? { category } : {}) });

export const ACTIVITIES: Activity[] = [
  a('walk-slow', 'Walking, slow (about 3 km/h)', 2.8, 'Walking'),
  a('walk-moderate', 'Walking, moderate (about 5 km/h)', 3.5, 'Walking'),
  a('walk-brisk', 'Walking, brisk (about 5.6 km/h)', 4.3, 'Walking'),
  a('walk-fast', 'Walking, fast (about 6.4 km/h)', 5.0, 'Walking'),
  a('walk-dog', 'Walking the dog', 3.0, 'Walking'),
  a('hike', 'Hiking, cross-country', 6.0, 'Walking'),
  a('backpack', 'Backpacking', 7.0, 'Walking'),
  a('run-8', 'Running, about 8 km/h (5 mph)', 8.3, 'Running'),
  a('run-10', 'Running, about 10 km/h (6 mph)', 9.8, 'Running'),
  a('run-11', 'Running, about 11 km/h (7 mph)', 11.0, 'Running'),
  a('run-13', 'Running, about 13 km/h (8 mph)', 11.8, 'Running'),
  a('run-14', 'Running, about 14.5 km/h (9 mph)', 12.8, 'Running'),
  a('jog', 'Jogging, general', 7.0, 'Running'),
  a('bike-leisure', 'Cycling, leisure (under 16 km/h)', 4.0, 'Cycling'),
  a('bike-moderate', 'Cycling, moderate (16–19 km/h)', 6.8, 'Cycling'),
  a('bike-fast', 'Cycling, fast (19–22 km/h)', 8.0, 'Cycling'),
  a('bike-vigorous', 'Cycling, vigorous (22–26 km/h)', 10.0, 'Cycling'),
  a('bike-mountain', 'Mountain biking', 8.5, 'Cycling'),
  a('bike-stationary-light', 'Stationary bike, light effort', 3.5, 'Cycling'),
  a('bike-stationary-moderate', 'Stationary bike, moderate effort', 6.8, 'Cycling'),
  a('bike-stationary-vigorous', 'Stationary bike, vigorous effort', 8.8, 'Cycling'),
  a('swim-light', 'Swimming laps, light to moderate', 5.8, 'Swimming'),
  a('swim-vigorous', 'Swimming laps, vigorous', 9.8, 'Swimming'),
  a('swim-leisure', 'Swimming, leisurely', 6.0, 'Swimming'),
  a('row-machine', 'Rowing machine, moderate', 7.0, 'Gym cardio'),
  a('row-machine-vigorous', 'Rowing machine, vigorous', 8.5, 'Gym cardio'),
  a('elliptical', 'Elliptical trainer', 5.0, 'Gym cardio'),
  a('stair-machine', 'Stair-climbing machine', 9.0, 'Gym cardio'),
  a('aerobics', 'Aerobics class', 7.3, 'Classes'),
  a('dance-ballroom-slow', 'Dancing, ballroom slow', 3.0, 'Classes'),
  a('dance-ballroom-fast', 'Dancing, ballroom fast', 5.5, 'Classes'),
  a('dance-general', 'Dancing, general', 7.8, 'Classes'),
  a('yoga', 'Yoga, hatha', 2.5, 'Mind & body', 'yoga'),
  a('yoga-power', 'Yoga, power', 4.0, 'Mind & body', 'yoga'),
  a('pilates', 'Pilates (mat, general)', 3.0, 'Mind & body', 'pilates'),
  a('pilates-reformer', 'Pilates, reformer or vigorous class', 4.0, 'Mind & body', 'pilates'),
  a('barre', 'Barre class', 3.5, 'Mind & body', 'pilates'),
  a('tai-chi', 'Tai chi', 3.0, 'Mind & body'),
  a('stretching', 'Stretching, gentle', 2.3, 'Mind & body'),
  a('strength-light', 'Strength training, light to moderate effort', 3.5, 'Strength & circuits'),
  a('strength-vigorous', 'Strength training, vigorous effort', 6.0, 'Strength & circuits'),
  a('circuit', 'Circuit training', 8.0, 'Strength & circuits'),
  a('calisthenics-light', 'Calisthenics, light to moderate', 3.8, 'Strength & circuits'),
  a('calisthenics-vigorous', 'Calisthenics, vigorous', 8.0, 'Strength & circuits'),
  a('hiit', 'HIIT (high-intensity interval training)', 8.0, 'Functional & HIIT', 'hiit'),
  a('tabata', 'Tabata or interval class', 8.0, 'Functional & HIIT', 'hiit'),
  a('bootcamp', 'Boot camp', 8.0, 'Functional & HIIT', 'hiit'),
  a('functional-training', 'Functional training, general', 6.0, 'Functional & HIIT', 'functional'),
  a('crossfit', 'CrossFit (WOD with warm-up and skill work)', 8.0, 'Functional & HIIT', 'crossfit'),
  a('hyrox-training', 'Hyrox training session', 8.5, 'Functional & HIIT', 'hyrox'),
  a('hyrox-race', 'Hyrox race or full simulation', 10.5, 'Functional & HIIT', 'hyrox'),
  a('kettlebell', 'Kettlebell workout', 9.0, 'Functional & HIIT', 'functional'),
  a('spin-class', 'Indoor cycling class', 8.5, 'Classes'),
  a('boxing-bag', 'Boxing or kickboxing, bag and pads', 7.8, 'Classes'),
  a('jump-rope', 'Jumping rope, moderate', 11.8, 'Strength & circuits'),
  a('basketball', 'Basketball, game', 8.0, 'Sports'),
  a('soccer-casual', 'Soccer, casual', 7.0, 'Sports'),
  a('soccer-match', 'Soccer, competitive', 10.0, 'Sports'),
  a('tennis-singles', 'Tennis, singles', 8.0, 'Sports'),
  a('tennis-doubles', 'Tennis, doubles', 6.0, 'Sports'),
  a('badminton', 'Badminton, social', 5.5, 'Sports'),
  a('volleyball', 'Volleyball, non-competitive', 3.0, 'Sports'),
  a('table-tennis', 'Table tennis', 4.0, 'Sports'),
  a('football-touch', 'Football or touch rugby, general', 8.0, 'Sports'),
  a('baseball', 'Baseball or softball', 5.0, 'Sports'),
  a('kayak', 'Kayaking, moderate', 5.0, 'Outdoors'),
  a('ski-downhill', 'Skiing, downhill', 5.3, 'Outdoors'),
  a('frisbee', 'Frisbee, casual', 3.0, 'Outdoors'),
  a('gardening', 'Gardening, general', 3.8, 'Everyday'),
  a('housework', 'Cleaning, general', 3.3, 'Everyday'),
  a('bowling', 'Bowling', 3.0, 'Everyday'),
];

export const ACTIVITY_SOURCE = 'Compendium of Physical Activities (Ainsworth et al., 2011), rounded values for common activities';
