// Plain-language guides for gym machines and cable stations, written for Fitwell (not copied from anywhere). Machines
// differ by brand, so these describe what to adjust and what to feel rather than exact settings. Pure.

export interface MachineGuide {
  id: string;
  title: string;
  /** What to adjust before the first rep. */
  setup: string[];
  /** What good form feels like. */
  cues: string[];
  mistakes: string[];
}

interface Entry extends MachineGuide {
  /** Matched against the exercise name; the first entry that matches wins, so specific ones come first. */
  match: RegExp;
}

const ENTRIES: Entry[] = [
  {
    id: 'smith',
    title: 'Smith machine',
    match: /smith/i,
    setup: [
      'The bar runs on fixed rails, so set your body position, not the bar path: your feet or bench should sit so the bar travels over the right spot (over mid-foot for squats, over the chest for bench press).',
      'Set the safety stops at a height you can reach if you fail a rep, and learn how to rotate the bar hooks to unrack and rerack.',
      'Start lighter than with a free barbell; the bar does not wobble, but your joints still feel the load.',
    ],
    cues: ['Brace your core and keep the same body position on every rep.', 'Because the path is fixed, feet slightly forward of the bar often feels better for squats.', 'Rotate the hooks to rerack before your arms or legs give out.'],
    mistakes: ['Standing directly under the bar and forcing a straight path through the knees or lower back.', 'Setting the safety stops too low to be useful.', 'Using the fixed path as a reason to skip warm-up sets.'],
  },
  {
    id: 'leg-press',
    title: 'Leg press',
    match: /leg press|lying machine squat/i,
    setup: [
      'Sit with your back and hips flat against the pad. Adjust the backrest so that at the bottom your knees bend to about 90° without your hips lifting or your lower back rounding.',
      'Put your feet about shoulder-width apart in the middle of the platform. Higher on the platform works the glutes and hamstrings more, lower works the quads more.',
      'Load the plates evenly on both sides and secure them. Set the safety stops to a depth you can control, then release the starting handles.',
    ],
    cues: ['Lower slowly to about 90° at the knee, or as deep as you can while your hips stay flat on the pad.', 'Push through the whole foot, mid-foot and heel rather than the toes.', 'Keep your knees in line with your toes.', 'Stop just short of locking your knees at the top.'],
    mistakes: ['Letting your hips roll up and your lower back round at the bottom.', 'Knees caving inward.', 'Locking the knees hard at the top, or pushing off your knees with your hands.'],
  },
  {
    id: 'hack-squat',
    title: 'Hack squat machine',
    match: /hack squat/i,
    setup: ['Step onto the platform and put your back and shoulders against the pads, with your shoulders under the shoulder pads.', 'Place your feet about shoulder-width apart, a little forward so your knees do not travel far past your toes. A narrow stance works the quads, a wider one adds the glutes.', 'Release the safety handles and set the stops to a depth you can control.'],
    cues: ['Lower under control until your thighs are about parallel to the platform, if your knees and hips allow.', 'Keep your back and head against the pad.', 'Drive through your whole foot and stop short of locking your knees.'],
    mistakes: ['Heels lifting off the platform.', 'Bouncing at the bottom.', 'Going deeper than your hips can keep flat against the pad.'],
  },
  {
    id: 'leg-extension',
    title: 'Leg extension machine',
    match: /leg extension/i,
    setup: ['Adjust the seat so your knees line up with the machine\'s pivot point and your back is supported.', 'Set the shin pad just above your ankles, not on the front of your foot.', 'Choose a light weight first: the knee is under direct load, so build up gradually.'],
    cues: ['Straighten your legs with control and squeeze your thighs at the top, without snapping the knees straight.', 'Lower slowly, about twice as slowly as you lift.', 'Keep your hips down on the seat.'],
    mistakes: ['Swinging the weight up with momentum.', 'Lifting your hips off the seat.', 'Letting the stack crash down at the bottom.'],
  },
  {
    id: 'leg-curl',
    title: 'Leg curl machine',
    match: /leg curl/i,
    setup: ['Line your knees up with the machine\'s pivot point. Lying: the pad sits just above your heels. Seated or standing: adjust the thigh pad so it holds your leg in place.', 'Set the range so the weight starts with your legs almost straight and your hamstrings stay under tension.', 'Start light, since hamstrings tolerate sudden heavy loads poorly.'],
    cues: ['Curl your heels toward your glutes with a steady pace and squeeze at the top.', 'Lower slowly until your legs are almost straight.', 'Keep your hips pressed into the pad.'],
    mistakes: ['Lifting your hips to cheat the curl.', 'Jerking the weight at the start.', 'Cutting the lowering phase short.'],
  },
  {
    id: 'calf',
    title: 'Calf raise machine',
    match: /calf (raise|press)|calf-machine|donkey calf|seated calf/i,
    setup: ['Seated: place the pad on your lower thighs just above the knees. Standing: put the shoulder pads on your shoulders and stand tall.', 'Put the balls of your feet on the platform edge with your heels hanging off, feet about hip-width.', 'Release the safety and let your heels drop to a comfortable stretch.'],
    cues: ['Rise as high as you can onto your toes and pause for a moment at the top.', 'Lower slowly into a full stretch at the bottom.', 'Keep your knees steady rather than bouncing.'],
    mistakes: ['Bouncing instead of pausing at the top and bottom.', 'Using a small range of motion.', 'Rolling your ankles outward or inward.'],
  },
  {
    id: 'lat-pulldown',
    title: 'Lat pulldown',
    match: /^(?!.*straight-arm).*pull-?down/i,
    setup: ['Adjust the thigh pad so it holds you down when you pull, with your knees under it.', 'Take the bar slightly wider than shoulder-width for the wide-grip version, or the narrow or V handle for the close-grip ones.', 'Sit upright with your chest up and arms reaching up, shoulder blades lightly set.'],
    cues: ['Pull the bar to your upper chest while you lean back only slightly.', 'Lead with your elbows, driving them down and slightly back, and squeeze your shoulder blades together.', 'Let the bar rise under control until your arms are fully stretched.'],
    mistakes: ['Pulling the bar behind the neck, which loads the shoulders awkwardly.', 'Leaning far back and swinging the weight.', 'Shrugging your shoulders up toward your ears.'],
  },
  {
    id: 'seated-row',
    title: 'Seated cable row',
    match: /seated cable row|low[- ]pulley row|one-arm cable pulley row|seated one-arm cable|elevated cable row|kneeling.*pulley row|shotgun row/i,
    setup: ['Sit with your feet braced on the footplate and your knees slightly bent, and reach forward to hold the handle with your back straight.', 'Sit tall with your chest up. The movement comes from the arms and upper back, not from rocking your whole body.'],
    cues: ['Pull the handle toward your lower ribs and squeeze your shoulder blades together.', 'Keep your elbows close to your body for a close grip, or flared a little for a wide one.', 'Return slowly, letting your shoulder blades spread, without rounding your lower back.'],
    mistakes: ['Rocking your torso back and forth to move the weight.', 'Shrugging your shoulders.', 'Rounding your lower back as you reach forward.'],
  },
  {
    id: 'chest-supported-row',
    title: 'Row machine (chest-supported)',
    match: /leverage (high|iso) row|lying t-bar row|t-bar row machine/i,
    setup: ['Adjust the seat so the chest pad rests against your breastbone and you can reach the handles with your arms nearly straight.', 'Grip the handles and keep your chest against the pad throughout.'],
    cues: ['Pull your elbows back and squeeze your shoulder blades together.', 'Pause briefly, then lower slowly until your arms are straight.', 'Keep your chest on the pad.'],
    mistakes: ['Peeling your chest off the pad to jerk the weight.', 'Shrugging toward your ears.', 'Letting the weight pull your shoulders forward on the way back.'],
  },
  {
    id: 'chest-press',
    title: 'Chest press machine',
    match: /machine bench press|leverage (incline |decline )?chest press/i,
    setup: ['Adjust the seat so the handles are level with the middle of your chest.', 'Sit with your back and head against the pad and your feet flat on the floor or footrest.', 'Grip the handles with your wrists straight over your forearms.'],
    cues: ['Press forward until your arms are almost straight, without locking your elbows.', 'Return slowly until you feel a stretch across your chest, not a strain in the shoulders.', 'Keep your shoulder blades pulled back against the pad.'],
    mistakes: ['Lifting your shoulders up toward your ears.', 'Letting the elbows drop far behind your torso.', 'Arching your lower back off the seat.'],
  },
  {
    id: 'pec-deck',
    title: 'Pec deck and reverse fly machine',
    match: /^butterfly$|pec deck|reverse machine fl/i,
    setup: ['Adjust the seat so the handles or pads are at about shoulder height.', 'For the chest version, sit facing the pad with your chest up. For the reverse fly (rear shoulders), face the pad and hold the rear handles.', 'Set the arm start position so you feel a gentle stretch, not a strain, at the start.'],
    cues: ['Move the handles in a wide arc with a slight bend in your elbows.', 'Squeeze at the end of the movement, then return slowly.', 'Keep your back against the pad and your shoulders down.'],
    mistakes: ['Using momentum to swing the handles.', 'Setting the start position so far back that your shoulders are pulled forward.', 'Straightening your elbows completely.'],
  },
  {
    id: 'shoulder-press-machine',
    title: 'Shoulder press machine',
    match: /machine shoulder|leverage shoulder press/i,
    setup: ['Adjust the seat so the handles start at about shoulder height, or just above your shoulders.', 'Sit with your back against the pad and your feet flat on the floor.'],
    cues: ['Press up until your arms are almost straight, without locking out your elbows.', 'Lower under control back to shoulder height.', 'Keep your ribs down and your lower back against the pad.'],
    mistakes: ['Arching your back to press the weight up.', 'Shrugging toward your ears.', 'Dropping the handles quickly at the bottom.'],
  },
  {
    id: 'ab-machine',
    title: 'Ab crunch machine',
    match: /ab crunch machine/i,
    setup: ['Adjust the seat so the pivot point sits at the level of your waist, and set the pads or handles comfortably in front of or above your chest.', 'Hook your feet under the rollers if there are any, and begin with a light load.'],
    cues: ['Curl your ribs toward your hips, breathing out as you crunch.', 'Pause for a moment at the bottom, then return slowly.', 'Keep your hips on the seat; the movement is a curl, not a bend from the hips.'],
    mistakes: ['Pulling with your arms instead of curling your trunk.', 'Using weight so heavy that your hip flexors do all the work.', 'Moving quickly and bouncing back up.'],
  },
  {
    id: 'hip-machine',
    title: 'Hip abduction and adduction machine',
    match: /thigh abductor|thigh adductor|hip (ab|ad)duction machine/i,
    setup: ['Sit with your back against the pad and set the leg pads at the outside (abduction) or inside (adduction) of your knees.', 'Set the start position with a comfortable stretch: for adduction, do not start with the legs so wide that you feel a strain in the groin.', 'Start with a light weight.'],
    cues: ['Move your legs out (or together) in a steady rhythm, without jerking.', 'Pause briefly at the end of the movement and return slowly.', 'Keep your back against the pad.'],
    mistakes: ['Swinging the weight with momentum.', 'Starting with the legs too far apart.', 'Leaning forward to shift the work to your back.'],
  },
  {
    id: 'dip-machine',
    title: 'Seated dip machine',
    match: /dip machine/i,
    setup: ['Adjust the seat so the handles are at about the level of your lower chest.', 'Sit upright with your back against the pad and your elbows close to your sides.'],
    cues: ['Press down until your arms are almost straight, without locking out your elbows.', 'Return slowly, bringing your elbows only to about shoulder level.'],
    mistakes: ['Letting your shoulders roll forward at the bottom.', 'Flaring your elbows out wide.', 'Using a weight so heavy that your shoulders shrug up.'],
  },
  {
    id: 'arm-machine',
    title: 'Biceps and triceps machines',
    match: /machine (bicep|preacher|triceps)/i,
    setup: ['Adjust the seat so your upper arms rest comfortably on the pad and the elbow lines up with the machine\'s pivot point.', 'Take a weight you can move through the full range without swinging.'],
    cues: ['Keep your upper arms against the pad and move only at the elbow.', 'Squeeze at the end of the movement and lower slowly.'],
    mistakes: ['Lifting your upper arms off the pad.', 'Using momentum from your shoulders or back.', 'Dropping the weight quickly on the way back.'],
  },
  {
    id: 'treadmill',
    title: 'Treadmill',
    match: /treadmill/i,
    setup: ['Clip the safety key to your clothing, stand on the side rails and start the belt at a slow speed before stepping on.', 'Warm up for a few minutes at an easy pace. Raise the speed or incline gradually.'],
    cues: ['Look ahead, keep your shoulders relaxed and let your arms swing naturally.', 'Land with your foot under your body, not far in front.', 'Avoid holding the handrails for balance unless you need to; it lowers the effort.'],
    mistakes: ['Hanging on to the rails.', 'Stepping off while the belt is still fast.', 'Increasing speed and incline at the same time.'],
  },
  {
    id: 'bike',
    title: 'Stationary and recumbent bike',
    match: /bicycling, stationary|recumbent bike|stationary bike/i,
    setup: ['Upright bike: set the saddle so your knee has a slight bend at the bottom of the pedal stroke. Recumbent bike: slide the seat so your knee stays slightly bent at full extension.', 'Strap or place your feet firmly on the pedals and pick a light resistance for the warm-up.'],
    cues: ['Keep a steady rhythm of about 70 to 90 revolutions a minute.', 'Keep your shoulders and hands relaxed, without gripping the bars tightly.', 'Raise the resistance in small steps.'],
    mistakes: ['Setting the saddle too low, which strains the knees.', 'Rocking your hips side to side.', 'Pedalling at very high resistance and very low cadence.'],
  },
  {
    id: 'elliptical',
    title: 'Elliptical trainer',
    match: /elliptical/i,
    setup: ['Step on holding the handles, place your feet flat on the pedals and start at a low resistance.'],
    cues: ['Stand tall and keep your weight over your feet.', 'Push and pull the handles in rhythm with your legs.', 'Keep your whole foot on the pedal.'],
    mistakes: ['Leaning on the handles and bending forward.', 'Letting your heels lift.', 'Using a stride so short or so long that the movement feels forced.'],
  },
  {
    id: 'rower',
    title: 'Rowing machine',
    match: /rowing, stationary|rowing machine/i,
    setup: ['Strap your feet in over the middle of your feet. Set the damper to a low or medium setting (a higher number is not always harder or better).', 'Sit tall and hold the handle with your arms straight.'],
    cues: ['Drive first with your legs, then lean back slightly, then pull the handle to your lower ribs.', 'On the way back, extend your arms first, then bend forward from the hips, then bend the knees.', 'Keep your back straight and the chain moving smoothly.'],
    mistakes: ['Pulling with the arms before the legs have pushed.', 'Rounding your back at the catch.', 'Rushing back to the start in the recovery.'],
  },
  {
    id: 'stairs',
    title: 'Stair climber',
    match: /stairmaster|step mill/i,
    setup: ['Step on holding the rails, and start at a slow speed before settling in.'],
    cues: ['Stand tall with your whole foot on the step.', 'Hold the rails lightly for balance only.'],
    mistakes: ['Leaning your weight onto the handles.', 'Taking very small, fast steps on your toes.'],
  },
];

/** Cable stations: pulley height and attachment are the main choices. */
const CABLE: MachineGuide = {
  id: 'cable-station',
  title: 'Cable station',
  setup: [
    'Set the pulley height for the exercise: high for pushdowns and pulldowns, low for curls and rows, about chest height for presses and flyes.',
    'Pick the attachment (straight bar, rope, V-bar, handle), clip it on firmly and choose a light weight to start.',
    'Stand or sit with a stable stance, so the cable does not pull you off balance.',
  ],
  cues: ['Keep the movement slow and controlled, and let the weight stack stay under tension without resting at the bottom.', 'Keep your torso still: only the joint the exercise targets should move.', 'Return slowly rather than letting the cable pull your arm back.'],
  mistakes: ['Using momentum from the hips and back.', 'Setting the pulley at a height that changes the angle of the exercise.', 'Letting the weight stack crash down between reps.'],
};

const MACHINE: MachineGuide = {
  id: 'machine',
  title: 'Gym machine',
  setup: [
    'Adjust the seat and pads so the machine\'s pivot lines up with the joint that moves (the knee, elbow or shoulder), and so you are supported against the pad.',
    'Check the starting position: a stretch is fine, a strain is not. Use the range adjustment if the machine has one.',
    'Start light, and ask gym staff to show you the adjustments if you have not used the machine before.',
  ],
  cues: ['Move with control in both directions, a steady lift and a slower lowering.', 'Keep your back against the pad and avoid locking joints at the end of the range.', 'Breathe out as you push or pull and breathe in as you return.'],
  mistakes: ['Choosing a weight that needs momentum to move.', 'Leaving the seat unadjusted so the machine\'s pivot does not match your joint.', 'Cutting the range short.'],
};

/**
 * The guide for an exercise on a machine or a cable station: a specific one by name, else cable or generic machine
 * guidance. Exercises with other equipment (a barbell hack squat, a band hip adduction) get none, whatever their name.
 */
export function machineGuideFor(name: string, equipment: string): MachineGuide | null {
  if (equipment !== 'machine' && equipment !== 'cable') return null;
  const hit = ENTRIES.find((e) => e.match.test(name));
  if (hit) return { id: hit.id, title: hit.title, setup: hit.setup, cues: hit.cues, mistakes: hit.mistakes };
  if (equipment === 'cable') return CABLE;
  if (equipment === 'machine') return MACHINE;
  return null;
}

export const MACHINE_GUIDE_IDS = [...ENTRIES.map((e) => e.id), CABLE.id, MACHINE.id];

/** Shown under every guide: machines vary and pain is a reason to stop. */
export const MACHINE_FOOTNOTE = 'Machines differ by make, so use these as a starting point. Start light, and stop if something hurts in a sharp way.';
