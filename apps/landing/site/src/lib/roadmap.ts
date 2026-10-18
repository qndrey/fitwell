// The public roadmap, in plain words. The detailed plan lives in apps/mcp/ROADMAP.md; keep this in step with it.
// No dates on purpose: the order is the plan, the timing is not a promise.

export type ThemeId = "coaching" | "logging" | "streaks" | "friends" | "devices" | "hosts";
export type StageId = "shipped" | "next" | "then" | "after" | "later";
export type Status = "shipped" | "next" | "planned" | "exploring";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "coaching", label: "Coaching" },
  { id: "logging", label: "Logging" },
  { id: "streaks", label: "Streaks" },
  { id: "friends", label: "Friends" },
  { id: "devices", label: "Devices" },
  { id: "hosts", label: "More chats" },
];

export const STAGES: { id: StageId; label: string; sub: string; blurb: string }[] = [
  { id: "shipped", label: "Shipped", sub: "Live today", blurb: "Already in Fitwell. Ask Claude to try any of it." },
  {
    id: "next",
    label: "Next",
    sub: "Streaks and friends",
    blurb: "What is being built now: reasons to come back, and training with people you trust.",
  },
  {
    id: "then",
    label: "Then",
    sub: "Your data and ChatGPT",
    blurb: "Less typing: bring in steps, sleep and runs, and check how Fitwell works in ChatGPT.",
  },
  {
    id: "after",
    label: "After",
    sub: "Smarter coaching and crew",
    blurb: "Training blocks that plan their own deloads, and friendly competition.",
  },
  { id: "later", label: "Later", sub: "Ideas we are exploring", blurb: "Good ideas that are not scheduled yet. They may change or never happen." },
];

export type RoadmapItem = {
  id: string;
  stage: StageId;
  theme: ThemeId;
  status: Status;
  title: string;
  summary: string;
  detail: string;
};

export const ITEMS: RoadmapItem[] = [
  // Shipped
  {
    id: "burn",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "Your real calorie burn",
    summary: "A goal based on what you actually burn, not a formula.",
    detail:
      "After a few weeks of logging and weigh-ins, Fitwell works out how much you burn, suggests a calorie goal for the pace you want and projects when you reach your goal weight. Claude asks before changing anything.",
  },
  {
    id: "repeat",
    stage: "shipped",
    theme: "logging",
    status: "shipped",
    title: "Same breakfast as yesterday",
    summary: "Log a repeat meal, or a saved recipe, in one message.",
    detail: "Copy a whole day or one meal, or log a recipe by name. Allergy checks still run on copies.",
  },
  {
    id: "labels",
    stage: "shipped",
    theme: "logging",
    status: "shipped",
    title: "Label checks",
    summary: "Photographed nutrition labels get sanity-checked.",
    detail:
      "Impossible values are refused and a calories-versus-macros mismatch is flagged before the food is saved, so a misread label does not quietly skew your day.",
  },
  {
    id: "sets",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "Supersets, timed sets, warm-ups",
    summary: "The workout player grew up.",
    detail:
      "Supersets go round by round, timed sets count down, heavy lifts get a warm-up ramp and the plate calculator shows what to load on each side of your bar.",
  },
  {
    id: "swap",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "Swap an exercise",
    summary: "Machine busy? Get similar exercises for the same muscles.",
    detail: "Ranked by muscle and movement, within the equipment you have. Sets, reps and rest carry over.",
  },
  {
    id: "heatmap",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "Muscle map",
    summary: "A 3D body coloured by how much each muscle is trained.",
    detail: "Hard sets per week against the usual 10 to 20, over 1, 4 or 12 weeks, with the numbers listed beside the colours.",
  },
  {
    id: "sessions",
    stage: "shipped",
    theme: "logging",
    status: "shipped",
    title: "Whole-body sessions",
    summary: "Pilates, yoga, HIIT, CrossFit, Hyrox and functional training.",
    detail: "Log sessions that are not sets and reps, so they count in your week and your review.",
  },
  {
    id: "morning",
    stage: "shipped",
    theme: "logging",
    status: "shipped",
    title: "Morning brief",
    summary: "A daily summary from a scheduled Claude task.",
    detail: "Set it up once in Claude and your day starts with what is left to eat and what is planned.",
  },

  // Next
  {
    id: "streaks",
    stage: "next",
    theme: "streaks",
    status: "next",
    title: "Streaks that forgive",
    summary: "Weeks of training and days of logging, without punishing a rest week.",
    detail:
      "A training week counts when you hit your workout target. One rest or sick week in twelve, or a freeze you set, keeps the streak. Logging counts any day with at least one meal, so partial days do not hurt. Milestones at 1, 2, 3, 5, 7, 14, 21, 30 and 52.",
  },
  {
    id: "celebrate",
    stage: "next",
    theme: "streaks",
    status: "next",
    title: "Celebrations",
    summary: "A calm moment when you hit a milestone, once.",
    detail:
      "Seven weeks of training, thirty days of logging, goal weight reached. A quiet animation (still when you prefer reduced motion), what it took and what is next. No confetti, and never repeated.",
  },
  {
    id: "cards",
    stage: "next",
    theme: "streaks",
    status: "next",
    title: "Share cards",
    summary: "A picture of your milestone, if you want to post it.",
    detail:
      "Drawn on your own screen in feed, story or square sizes, light or dark. You choose the name and numbers. Weight is off unless you turn it on for that card, and nothing is posted for you.",
  },
  {
    id: "send",
    stage: "next",
    theme: "friends",
    status: "next",
    title: "Send a workout, recipe or plan",
    summary: "Give a friend a copy of what works for you.",
    detail: "They get their own copy when they accept. Nothing else about you becomes visible, and sharing is off by default.",
  },
  {
    id: "household",
    stage: "next",
    theme: "friends",
    status: "next",
    title: "Household meal plan",
    summary: "One plan and one shopping list for people who cook together.",
    detail: "Everyone keeps their own goals and portions, and the grocery list scales to the household.",
  },
  {
    id: "digests",
    stage: "next",
    theme: "logging",
    status: "next",
    title: "Email digests",
    summary: "A Sunday summary and a nudge when you go quiet. Opt-in.",
    detail: "Each digest is a separate switch, off until you turn it on, with an unsubscribe link in every email.",
  },

  // Then
  {
    id: "health",
    stage: "then",
    theme: "devices",
    status: "planned",
    title: "Apple Health, without an app",
    summary: "Steps, sleep, heart rate and weight arrive on their own.",
    detail:
      "A private link only you hold, fed by the Health Auto Export app or an iOS Shortcut. It also carries Garmin, Oura and Whoop data that already syncs into Apple Health. Values you type always win over imported ones.",
  },
  {
    id: "strava",
    stage: "then",
    theme: "devices",
    status: "planned",
    title: "Strava",
    summary: "Runs and rides show up as cardio.",
    detail: "Connect once and your activities appear, with device calories when your watch recorded them.",
  },
  {
    id: "today",
    stage: "then",
    theme: "logging",
    status: "planned",
    title: "Today view",
    summary: "What is left, what is planned and one-tap logging, on one screen.",
    detail: "Remaining macros, planned meals you tick off when eaten, your usual foods as quick adds, and today's workout.",
  },
  {
    id: "restaurant",
    stage: "then",
    theme: "logging",
    status: "planned",
    title: "Restaurant estimates",
    summary: "Eating out, with an honest range.",
    detail: "Saved as a midpoint and marked as an estimate, and your weekly review says how much of your intake was estimated.",
  },
  {
    id: "chatgpt",
    stage: "then",
    theme: "hosts",
    status: "exploring",
    title: "ChatGPT",
    summary: "Testing first, no promises until it works properly.",
    detail:
      "Fitwell is a standard connector, so it may work in ChatGPT, but the workout player and some plans' limits are unproven. Claude stays the main, supported home. Results will be published here once tested.",
  },

  // After
  {
    id: "programs",
    stage: "after",
    theme: "coaching",
    status: "planned",
    title: "Programs with deloads",
    summary: "Multi-week blocks that plan their own easy week.",
    detail: 'Linear, double progression or percentage waves, and "Week 3, Day B" offered when you start a workout.',
  },
  {
    id: "rpe",
    stage: "after",
    theme: "coaching",
    status: "planned",
    title: "Effort per set",
    summary: "Log how hard a set felt and let loads follow.",
    detail: "An easier-than-planned set adds load next time. A harder one holds or backs off.",
  },
  {
    id: "volume",
    stage: "after",
    theme: "coaching",
    status: "planned",
    title: "Weekly volume ranges",
    summary: "Flags muscles that are under- or over-trained.",
    detail: "Builds on the muscle map with a plain verdict for each group.",
  },
  {
    id: "micros",
    stage: "after",
    theme: "logging",
    status: "planned",
    title: "Micronutrients",
    summary: "Iron, B12, sodium and more, and protein per meal.",
    detail: "The food database has them. They need to be added without making Fitwell slower.",
  },
  {
    id: "feed",
    stage: "after",
    theme: "friends",
    status: "planned",
    title: "Crew feed",
    summary: "See friends' finished workouts and send kudos.",
    detail: "Only what each friend chose to share. Body weight is never in a feed.",
  },
  {
    id: "challenges",
    stage: "after",
    theme: "friends",
    status: "planned",
    title: "Challenges",
    summary: "Friendly, time-boxed and about consistency.",
    detail: "Workouts per week or protein days, rest-day friendly, never weight or body fat. Results arrive by email when it closes.",
  },

  // Later
  {
    id: "readiness",
    stage: "later",
    theme: "coaching",
    status: "exploring",
    title: "Readiness",
    summary: "Sleep, heart rate and a quick check-in suggest a lighter day.",
    detail: "Needs device data first.",
  },
  {
    id: "breaks",
    stage: "later",
    theme: "coaching",
    status: "exploring",
    title: "Diet breaks and refeeds",
    summary: "Planned pauses in long cuts.",
    detail: "Plus more 3D movements and a second body figure.",
  },
  {
    id: "devices",
    stage: "later",
    theme: "devices",
    status: "exploring",
    title: "Oura, Whoop, Withings, Polar",
    summary: "Connect directly instead of through Apple Health.",
    detail: "Garmin's official access needs business approval, so Garmin goes through Apple Health or Strava.",
  },
  {
    id: "buddy",
    stage: "later",
    theme: "friends",
    status: "exploring",
    title: "Buddy and train together",
    summary: "A weekly note to someone you chose, and side-by-side sessions.",
    detail: "Opt-in on both sides, and nothing is shared unless you picked it.",
  },
  {
    id: "photos",
    stage: "later",
    theme: "logging",
    status: "exploring",
    title: "Progress photos",
    summary: "Needs its own storage and its own privacy decision.",
    detail: "Not started. It will only happen if it can be done as carefully as the rest of your data.",
  },
  {
    id: "listing",
    stage: "later",
    theme: "hosts",
    status: "exploring",
    title: "Official listings and Gemini",
    summary: "Directory listings once other chats work well.",
    detail: "Gemini does not support these interactive views yet, so only text answers would work there.",
  },
];

export const STATUS_LABEL: Record<Status, string> = {
  shipped: "Shipped",
  next: "Building",
  planned: "Planned",
  exploring: "Exploring",
};
