// The public roadmap, in plain words. The detailed plan lives in apps/mcp/ROADMAP.md; keep this in step with it.
// No dates on purpose: the order is the plan, the timing is not a promise.

export type ThemeId = "coaching" | "logging" | "streaks" | "friends" | "devices" | "hosts" | "start";
export type StageId = "shipped" | "next" | "then" | "after" | "later";
export type Status = "shipped" | "next" | "planned" | "exploring";

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: "coaching", label: "Coaching" },
  { id: "logging", label: "Logging" },
  { id: "streaks", label: "Streaks" },
  { id: "friends", label: "Friends" },
  { id: "devices", label: "Your data" },
  { id: "hosts", label: "More chats" },
  { id: "start", label: "Getting started" },
];

export const STAGES: { id: StageId; label: string; sub: string; blurb: string }[] = [
  { id: "shipped", label: "Shipped", sub: "Live today", blurb: "Already in Fitwell. Ask Claude to try any of it." },
  {
    id: "next",
    label: "Next",
    sub: "Quick wins, streaks and friends",
    blurb: "What is being built now: loads that follow your effort, an easier first day, reasons to come back, and training with people you trust.",
  },
  {
    id: "then",
    label: "Then",
    sub: "Your data and ChatGPT",
    blurb: "Less typing: bring in steps, sleep, runs and your history from other apps, and check how Fitwell works in ChatGPT.",
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
    detail:
      "Hard sets per week against the usual 10 to 20, over 1, 4 or 12 weeks, with the numbers listed beside the colours, the change since the period before, and how many days since each muscle was last trained.",
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
  {
    id: "player",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "A calmer workout player",
    summary: "One exercise per card, with the buttons where your thumb is.",
    detail:
      "Swipe from the overview through each exercise to the finish. The rest timer keeps running if the chat reloads, and a set that beats your best is called out as you log it.",
  },
  {
    id: "effort",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "How hard it felt",
    summary: "Tap Easy, Solid, Hard or Max after a set, or ignore it.",
    detail: "Saved with the set and shown in your history and summary, so Claude can see how close to the limit you trained.",
  },
  {
    id: "lift",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "Lift progress",
    summary: "One lift over time: estimated max, rep records and recent sessions.",
    detail: "Ask how your squat or bench is going and see the line, your best at 1, 3, 5 and 8 reps, and the last sessions.",
  },
  {
    id: "month",
    stage: "shipped",
    theme: "coaching",
    status: "shipped",
    title: "Week and month reviews",
    summary: "Your week or month against the one before, with notes from Claude.",
    detail:
      "Calories eaten against burned, a day-by-day strip, training volume and a calendar of trained days. Claude writes a short training and nutrition note that stays with that review.",
  },
  {
    id: "extras",
    stage: "shipped",
    theme: "logging",
    status: "shipped",
    title: "Fibre, sugar and salt",
    summary: "More than calories and macros, where the food data has it.",
    detail:
      "Fibre, sugars, added sugar, saturated fat and salt are kept with each meal, with optional goals for fibre, saturated fat and added sugar. A total is shown as a minimum when some foods have no data.",
  },
  {
    id: "request",
    stage: "shipped",
    theme: "start",
    status: "shipped",
    title: "Ask for an invite",
    summary: "Request access on this page and get step-by-step instructions by email.",
    detail: "Fitwell is still invite-only. Requests are kept for 30 days at most and deleted once answered.",
  },

  // Next
  {
    id: "rpe",
    stage: "next",
    theme: "coaching",
    status: "next",
    title: "Loads that follow your effort",
    summary: "The effort you tap decides next time's weight.",
    detail: "An easy set at the target reps adds load next time. A hard one holds, and a max effort holds or backs off. The reason is shown with the suggestion.",
  },
  {
    id: "injuries",
    stage: "next",
    theme: "coaching",
    status: "next",
    title: "Injuries remembered",
    summary: "Tell Claude once about a sore knee, not in every chat.",
    detail:
      "Saved only when you agree. Exercises that load that area are flagged in plans and swaps. Fitwell does not diagnose, and this stays private like the rest of your health data.",
  },
  {
    id: "firstday",
    stage: "next",
    theme: "start",
    status: "next",
    title: "A guided first day",
    summary: "From your invite to goals, a first workout and a first meal, in one chat.",
    detail: "Claude walks you through your profile, suggested targets and a starting template. Skip any step, and it is never asked twice.",
  },
  {
    id: "directory",
    stage: "next",
    theme: "start",
    status: "next",
    title: "Find Fitwell in Claude",
    summary: "A listing in Claude's connector directory.",
    detail: "So adding Fitwell is a click instead of a pasted address. It stays invite-only.",
  },
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
    id: "mealplan",
    stage: "then",
    theme: "logging",
    status: "planned",
    title: "Meal plan view",
    summary: "Your week of meals on one screen, to swap and repeat.",
    detail: "Swap a meal for a saved recipe, repeat a day and tick off what you ate, with the same goal and allergy checks as a plan made in chat.",
  },
  {
    id: "import",
    stage: "then",
    theme: "devices",
    status: "planned",
    title: "Bring your history",
    summary: "Import from Hevy, Strong, MyFitnessPal and MacroFactor.",
    detail:
      "Upload the export file those apps give you. It is read in your browser, never pasted into the chat, and nothing already in Fitwell is overwritten. Exercises that do not match are listed for you to check.",
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
    id: "volume",
    stage: "after",
    theme: "coaching",
    status: "planned",
    title: "Weekly volume ranges",
    summary: "Flags muscles that are under- or over-trained.",
    detail: "The muscle map already colours each group against 10 to 20 sets a week. Next: a plain verdict for each group in your weekly review.",
  },
  {
    id: "micros",
    stage: "after",
    theme: "logging",
    status: "planned",
    title: "Micronutrients",
    summary: "Iron, B12, calcium and more, and protein per meal.",
    detail: "Fibre, sugar and salt are already tracked. The food database has the vitamins and minerals too; they need to be added without making Fitwell slower.",
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
    title: "ChatGPT listing and Gemini",
    summary: "Listed in other chats' directories once Fitwell works well there.",
    detail: "Gemini does not support these interactive views yet, so only text answers would work there.",
  },
];

export const STATUS_LABEL: Record<Status, string> = {
  shipped: "Shipped",
  next: "Building",
  planned: "Planned",
  exploring: "Exploring",
};
