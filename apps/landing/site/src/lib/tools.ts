// The catalogue on the Tools page: every tool your assistant can use in Fitwell, in plain words. Keep it in step with apps/mcp (the tool list
// there is the source of truth; apps/mcp/tests/landing-tools.test.ts fails when a name here is not a real tool, or a real tool is neither listed nor skipped on purpose).
//
// kind: reads = only looks, saves = adds or changes something of yours, opens = shows a page in the chat (it may also read or save).
// asks: the assistant asks you first, because it changes or removes something.

export type ToolKind = "reads" | "saves" | "opens";

export type Tool = {
  name: string;
  what: string;
  /** What to say, as a person would. */
  ask: string;
  kind: ToolKind;
  asks?: boolean;
  /** The screenshots (without -light/-dark) of the page it opens. */
  shots?: { name: string; alt: string }[];
};

export type Category = { id: string; title: string; blurb: string; tools: Tool[] };

export const CATEGORIES: Category[] = [
  {
    id: "start",
    title: "Start here",
    blurb: "What Fitwell knows about you, and the numbers you aim for. Nothing is guessed: it asks, and it asks before it saves.",
    tools: [
      {
        name: "get_profile",
        kind: "saves",
        what: "Shows what is saved about you: time zone, units, body data, activity level, equipment, diet and allergies, your goals, and which emails you have turned on.",
        ask: "What do you have saved about me?",
      },
      {
        name: "add_injury",
        kind: "saves",
        what: "Remembers an injury or limitation you told Claude about, so you do not repeat it in every chat: the body area, your words, what to avoid, and when it started or should be over. Claude asks before saving and never diagnoses. Exercises that load that area are then flagged in searches, workouts and templates, and swaps rank the others first. It is private health data: never shared with friends or put on a card, in your export, and gone with your account.",
        ask: "My left shoulder pinches on overhead presses. Remember that.",
      },
      {
        name: "end_injury",
        kind: "saves",
        asks: true,
        what: "Marks a remembered injury as over, from today or a day you name, so its flags stop. It stays in your export until you ask to remove it.",
        ask: "My shoulder is fine now.",
      },
      {
        name: "update_profile",
        kind: "saves",
        asks: true,
        what: "Changes your profile, only the parts you name. It is also where you turn the optional emails on or off: a Sunday summary, and a nudge after a few quiet days. Both are off until you ask.",
        ask: "I train at home with a barbell and dumbbells, and I'm allergic to peanuts.",
      },
      {
        name: "suggest_targets",
        kind: "reads",
        what: "Works out a calorie and macro target from your body data and your goal, and says how it got there. After a few weeks of logs it can use your measured burn instead of a formula.",
        ask: "What should my calories be if I want to lose half a kilo a week?",
      },
      {
        name: "set_goals",
        kind: "saves",
        asks: true,
        what: "Saves calorie and macro targets, a fibre target, limits for saturated fat and added sugar, sleep, a daily water goal, workouts per week and a goal weight. Only what you name changes.",
        ask: "Set my goals to 2,300 kcal and 150 g of protein.",
      },
    ],
  },
  {
    id: "food",
    title: "Food",
    blurb: "Log what you ate by describing it. Values are per 100 g, so your portions are converted for you, and an estimate is always marked as one.",
    tools: [
      {
        name: "search_foods",
        kind: "reads",
        what: "Finds foods in your own foods, the Danish national food database (Frida) and, if you like, Open Food Facts for packaged products.",
        ask: "How much protein is in skyr?",
      },
      {
        name: "lookup_barcode",
        kind: "reads",
        what: "Finds a packaged product from its barcode number.",
        ask: "Look up 5701234567890.",
      },
      {
        name: "log_food",
        kind: "opens",
        what: "Logs one or several foods with calories, protein, carbs, fat, fibre, sugars and salt, then shows the day so far against your goals. It can repeat yesterday's breakfast, log a saved recipe, or log an estimate from a photo, clearly marked. A meal out is logged as a range, such as 600 to 900 kcal, and shown with that range, never as a made-up exact number; the weekly review says how much of your calories were estimates.",
        ask: "Same breakfast as yesterday.",
        shots: [{ name: "food", alt: "The summary after logging a lunch of oats and rye bread: calories today 549 of 2,300, then protein, carbs and fat against their goals" }],
      },
      {
        name: "show_today",
        kind: "opens",
        what: "Opens today on one screen: calories and protein left against your goals, today's planned meals with a one-tap \"eaten\", the foods you eat often to log again in one tap with the amount you had last time, water and steps, and what you trained, with the workout that has waited longest as a suggestion. Nothing changes until you tap.",
        ask: "What's left today?",
        shots: [{ name: "today", alt: "Today on one screen: 820 kcal left of 2,300 with a bar, planned breakfast logged and dinner with an Eaten button, foods to log again such as skyr and banana with an Add button, 750 ml of water and 8,200 steps, and a push day done with leg day suggested" }],
      },
      {
        name: "show_meal_plan",
        kind: "opens",
        what: "Opens a week of your meal plan: every day with its meals and its calories and protein against your goals, and any allergy or dislike match in plain words. Swap a meal for a saved recipe or copy another meal, repeat a day, and tick a meal as eaten, all in the view. Every change goes through the same allergy check as a plan made in chat, a meal you already ate is never changed, and two open windows cannot overwrite each other.",
        ask: "Show my meal plan for this week.",
        shots: [{ name: "mealplan", alt: "The meal plan for 2 to 8 November: Monday with three meals eaten, Tuesday with breakfast eaten, lunch and dinner with Eaten and Change buttons, and a panel open under the dinner to swap it for a saved recipe or copy Monday's dinner" }],
      },
      {
        name: "get_food_log",
        kind: "reads",
        what: "Shows a day or several days of what you logged, and what is left of your goals.",
        ask: "What have I eaten today, and what's left?",
      },
      {
        name: "edit_food_entry",
        kind: "saves",
        asks: true,
        what: "Changes the amount, the meal or the day of something you logged. The nutrition is rescaled to match.",
        ask: "That was 250 g, not 300 g.",
      },
      {
        name: "save_custom_food",
        kind: "saves",
        what: "Saves your own food from a label, or a food that is not in the databases, so you can log it by name.",
        ask: "Save this protein bar: 380 kcal, 30 g protein, 35 g carbs and 12 g fat per 100 g.",
      },
    ],
  },
  {
    id: "workouts",
    title: "Workouts",
    blurb: "Plan a workout with your assistant, then do it in a player inside the chat. Weights come from your history: add a step when every planned set hit its reps.",
    tools: [
      {
        name: "search_exercises",
        kind: "reads",
        what: "Finds exercises by name, muscle or equipment, shows instructions, and suggests substitutes when a machine is busy or you do not have it.",
        ask: "What can I do instead of a barbell row with only dumbbells?",
      },
      {
        name: "show_exercise",
        kind: "opens",
        what: "Opens a guide: an animated 3D body with the working muscles tinted, the steps, the machine setup and a link to find a demo video.",
        ask: "How do I do a barbell squat?",
        shots: [{ name: "guide-squat", alt: "The barbell squat guide: a 3D body at the bottom of a back squat with the quadriceps tinted, and a legend naming the main and supporting muscles" }],
      },
      {
        name: "start_workout",
        kind: "opens",
        what: "Opens the workout player: one exercise per card with big buttons and a rest timer. It can start the next session of your training program, planned lighter in a deload week. An exercise that loads an area you told Fitwell about is flagged on its card. It supports supersets, timed sets, warm-up ramps with the plates to load on each side, and swapping an exercise. Everything you do in the player (log a set, change the rest, add a note, log a cardio block, swap an exercise) is a button, not something you type.",
        ask: "Start my push day.",
        shots: [
          { name: "warmup", alt: "A warm-up set of barbell squats: warm-up 2 of 4, 5 reps at 50 kg, 15 kg each side on a 20 kg bar" },
          { name: "swap", alt: "Swap exercise opened under the barbell squat, listing similar exercises with their equipment" },
        ],
      },
      {
        name: "finish_workout",
        kind: "opens",
        what: "Ends the workout and opens a short report: what you did, new personal bests, the muscles trained and what is next.",
        ask: "I'm done.",
      },
      {
        name: "log_past_workout",
        kind: "saves",
        what: "Records a strength workout you already did, with its sets and weights.",
        ask: "Yesterday I did 3 sets of 5 squats at 100 kg and 3 sets of bench at 70.",
      },
      {
        name: "log_cardio",
        kind: "saves",
        what: "Logs a run, ride, swim or other activity, with an estimated or measured calorie burn.",
        ask: "I ran 5 km in 30 minutes this morning.",
      },
      {
        name: "log_session",
        kind: "saves",
        what: "Logs a whole-body session that is not sets and reps: Pilates, yoga, HIIT, CrossFit, Hyrox or functional training. It counts in your week and your muscle map.",
        ask: "I did a 60-minute Pilates class.",
      },
      {
        name: "edit_workout_set",
        kind: "saves",
        asks: true,
        what: "Corrects one logged set of a stored workout.",
        ask: "The last set of squats was 6 reps, not 5.",
      },
      {
        name: "get_workout_history",
        kind: "reads",
        what: "Lists your past workouts with their sets.",
        ask: "What did I do last week?",
      },
      {
        name: "suggest_progression",
        kind: "reads",
        what: "Suggests the next weights from your history and how hard the last sets felt: every set Easy adds two steps, Solid or Hard one, and a Max set keeps the weight.",
        ask: "What should I lift for squats next time?",
      },
      {
        name: "save_workout_template",
        kind: "saves",
        asks: true,
        what: "Saves a named workout such as Push day, with a note per exercise and optional warm-up or finisher cardio. Saving under a name you already use replaces it.",
        ask: "Save that as my push day.",
      },
      {
        name: "list_workout_templates",
        kind: "reads",
        what: "Lists your saved workouts.",
        ask: "What workouts do I have saved?",
      },
    ],
  },
  {
    id: "body",
    title: "Body",
    blurb: "Weight, measurements, sleep, steps and water. Fitwell talks about the 7-day average and the trend, never one weigh-in.",
    tools: [
      {
        name: "log_body",
        kind: "saves",
        asks: true,
        what: "Logs weight, measurements and body fat, sleep, steps and water for a day. A value logged for a day replaces the one already there.",
        ask: "I weighed 81.4 this morning and slept 7 hours.",
      },
    ],
  },
  {
    id: "progress",
    title: "Progress",
    blurb: "See how things are going. Trends use the 7-day average, so a single weigh-in does not move the line, and the tone stays neutral.",
    tools: [
      {
        name: "get_progress",
        kind: "reads",
        what: "The numbers over a period: weight trend, calories and macros against goals, training, strength records, measurements, your measured burn and your streaks.",
        ask: "How am I doing over the last 90 days?",
      },
      {
        name: "show_dashboard",
        kind: "opens",
        what: "Opens your progress on one screen: weight, nutrition, burn, training, strength, habits and measurements, one card each. Pick 30 days, 90 days or a year.",
        ask: "Show my progress.",
        shots: [{ name: "dashboard", alt: "The progress dashboard for 90 days: the weight trend with the weigh-ins, the 7-day average and the goal on a chart, and a row of icon tabs for the other cards" }],
      },
      {
        name: "create_program",
        kind: "saves",
        asks: true,
        what: "Makes a block of 2 to 16 weeks out of your saved workouts, with the days in order and an optional deload every few weeks. The deload week is about 60 % of the sets at about 90 % of the weight, and the weights afterwards carry on from your last normal session. It ends the program that was running, so it asks first.",
        ask: "Make a 6-week block of push, legs and pull with a deload every fourth week.",
      },
      {
        name: "get_program",
        kind: "reads",
        what: "Shows your program and what comes next, such as Week 3, Day B, and whether that is a deload week.",
        ask: "What is my next session?",
      },
      {
        name: "end_program",
        kind: "saves",
        asks: true,
        what: "Ends the program. The workouts you did stay.",
        ask: "Stop my program.",
      },
      {
        name: "show_muscle_map",
        kind: "opens",
        what: "Opens a 3D body coloured by hard sets per week for each muscle, against the usual 10 to 20, over 1, 4 or 12 weeks. Switch it to days since each muscle was trained, or to strength: whether the estimated one-rep max of the lifts that mainly work each muscle went up, stayed the same or went down since the period before.",
        ask: "Which muscles am I training?",
        shots: [{ name: "muscles", alt: "The muscle map for 4 weeks: a 3D body coloured by weekly hard sets, with a legend: not trained, under 10, 10 to 20, over 20" }],
      },
      {
        name: "show_lift_progress",
        kind: "opens",
        what: "Opens one lift: the estimated one-rep max over time with a mark on every new best, your rep records at 1, 3, 5 and 8 reps, and your last sessions.",
        ask: "How is my bench press going?",
        shots: [{ name: "lift", alt: "Barbell bench press progress: an estimated one-rep max as a rising line with a diamond on every new best, then the rep records and the last sessions" }],
      },
      {
        name: "show_weekly_review",
        kind: "opens",
        what: "Opens your week or month next to the one before: food, training, weight, sleep and meals, what went well, a few neutral suggestions, and a check-in on your real calorie burn. Each muscle group gets a plain verdict against the usual range, and Claude can add a short written note that stays with that week.",
        ask: "How did my week go?",
        shots: [
          { name: "review", alt: "The weekly review for 5 to 11 October: the week's calories, workouts and weigh-ins, then a row of icon tabs and the what-went-well card" },
          { name: "energy", alt: "The Energy card of the weekly review: burn a day, weight trend, calories to lose half a kilo a week and the date the goal weight is reached" },
        ],
      },
    ],
  },
  {
    id: "meals",
    title: "Meals and recipes",
    blurb: "A week of meals built around your goals, allergies and recipes, checked before you see it, and a shopping list you tick off in the chat.",
    tools: [
      {
        name: "save_recipe",
        kind: "saves",
        asks: true,
        what: "Saves a recipe with its ingredients, steps and servings. Saving under a name you already use replaces it.",
        ask: "Save my porridge: 80 g oats, 280 g milk and a banana.",
      },
      {
        name: "import_recipe",
        kind: "reads",
        what: "Reads a recipe from a web page so it can be matched to foods and saved.",
        ask: "Add the recipe at this link.",
      },
      {
        name: "get_recipes",
        kind: "reads",
        what: "Lists your recipes, or shows one with its nutrition per serving.",
        ask: "What recipes do I have?",
      },
      {
        name: "get_planning_context",
        kind: "reads",
        what: "Gathers what a meal plan needs: your goals, allergies, what you actually eat and your recipes.",
        ask: "Plan my meals for next week.",
      },
      {
        name: "save_meal_plan",
        kind: "saves",
        asks: true,
        what: "Saves a week of meals and reports any problem against your calorie and protein goals, and any allergy match, so it can be fixed before you see it. Saving a week again replaces it.",
        ask: "Save that plan for next week.",
      },
      {
        name: "get_meal_plan",
        kind: "reads",
        what: "Shows a week's plan and what to batch-cook.",
        ask: "What's on the menu this week?",
      },
      {
        name: "log_planned_meal",
        kind: "saves",
        what: "Logs a planned meal as eaten, in one step.",
        ask: "I had tonight's dinner as planned.",
      },
      {
        name: "show_grocery_list",
        kind: "opens",
        what: "Opens the week's shopping list, grouped into sections such as Produce and Meat, that you tick off in the shop. For a household it is one list for everyone's portions together, with ticks the whole household sees.",
        ask: "Show my shopping list.",
        shots: [
          { name: "shopping", alt: "The week's shopping checklist: 9 of 12 items left, grouped into sections such as Produce and Meat, with some items ticked off" },
          { name: "household", alt: "A household's shared shopping list for 2.5 portions: 5 of 7 items left, grouped into Produce, Meat and fish, and Dairy and eggs, with broccoli and salmon ticked off" },
        ],
      },
      {
        name: "suggest_meals",
        kind: "reads",
        what: "Ranks your recipes by what you have in the fridge and what is left of today's macros.",
        ask: "What can I cook with eggs, spinach and rice?",
      },
    ],
  },
  {
    id: "streaks",
    title: "Streaks and milestones",
    blurb: "Weeks of training and days of logging, counted from what you did. Forgiving by design: no streak is broken by one quiet week.",
    tools: [
      {
        name: "get_streaks",
        kind: "saves",
        what: "Your training, logging and protein streaks, and your goal weight, with the best run, what is running this week and how far the next milestone is. It notes each milestone you reach.",
        ask: "What's my streak?",
      },
      {
        name: "set_streak_freeze",
        kind: "saves",
        what: "Freezes a week for the weekly streaks, for a holiday, a planned rest or an illness, or lifts the freeze. A frozen week keeps the streak without adding to it.",
        ask: "I'm away next week, freeze it.",
      },
      {
        name: "show_celebration",
        kind: "opens",
        what: "A calm page when you reach a milestone (7 weeks of training, 30 days of logging, goal weight reached): the number, what it took and what is next. Shown once. From it you can make a card to share, drawn on your own screen in feed, story or square size, light or dark. Your name and weight are off unless you turn them on for that card, and nothing is posted for you.",
        ask: "Anything to celebrate?",
        shots: [
          { name: "milestone", alt: "A milestone page: a ring around the number 7 and the words 7 weeks of training, 23 workouts and 341 sets, next milestone 14 weeks" },
          { name: "sharecard", alt: "A share card in feed size: a ring around the number 7, 7 weeks of training, 3 workouts or more each week, the workouts and sets, the date and the word Fitwell" },
        ],
      },
    ],
  },
  {
    id: "friends",
    title: "Friends",
    blurb:
      "Connect by nickname, so nobody has to hand out an email address. Connecting shares nothing: you choose, per friend and one kind at a time, whether they see your workouts, your consistency (streaks, no numbers), your templates and recipes, or your body data, and you can take any of it back. Friends only ever see counts and names, never weights or notes.",
    tools: [
      {
        name: "set_nickname",
        kind: "saves",
        asks: true,
        what: "Gives you a nickname that is unique across Fitwell and shown to friends instead of your email.",
        ask: "Make my nickname ana_fit.",
      },
      {
        name: "request_friend",
        kind: "saves",
        what: "Asks someone to connect, by their nickname or the email they use with Fitwell. They see the request the next time they ask about friends.",
        ask: "Add bo.lifts as a friend.",
      },
      {
        name: "list_friends",
        kind: "reads",
        what: "Your friends, what each shares with the other, and requests waiting for an answer.",
        ask: "Who are my friends, and what do they see?",
      },
      {
        name: "accept_friend",
        kind: "saves",
        what: "Accepts a request. Nothing is shared yet.",
        ask: "Accept ana_fit.",
      },
      {
        name: "decline_friend",
        kind: "saves",
        asks: true,
        what: "Declines a request, or takes back one you sent. Nobody is told.",
        ask: "Decline that request.",
      },
      {
        name: "remove_friend",
        kind: "saves",
        asks: true,
        what: "Ends a friendship for both people. Everything either of you shared stops at once.",
        ask: "Remove bo.lifts.",
      },
      {
        name: "list_household",
        kind: "reads",
        what: "Shows the household you cook with: who is in it, each person's portion, the weeks that have a shared meal plan, and invitations waiting for you. Only the plan, the portions and the shopping ticks are shared. Nobody sees anyone else's goals, allergies or food log.",
        ask: "Who is in my household?",
      },
      {
        name: "invite_to_household",
        kind: "saves",
        what: "Invites a friend to cook together: one shared meal plan and shopping list, a portion each. They decide, and nothing is shared until they accept.",
        ask: "Invite bo.lifts to cook with me.",
      },
      {
        name: "accept_household_invite",
        kind: "saves",
        what: "Joins a household you were invited to. From then on its meal plans and shopping list are shared with you.",
        ask: "Join Ana's household.",
      },
      {
        name: "decline_household_invite",
        kind: "saves",
        asks: true,
        what: "Turns down an invitation to a household and deletes it.",
        ask: "No thanks to that household invite.",
      },
      {
        name: "set_household_portion",
        kind: "saves",
        asks: true,
        what: "Sets how much of the shared meal plan you eat: 1 is the amounts as planned, 0.5 half of them. Your copy of the plan scales to it, and the shopping list adds up everyone's portions.",
        ask: "I only eat half portions of the shared plan.",
      },
      {
        name: "use_household_plan",
        kind: "saves",
        asks: true,
        what: "Makes your own plan for a week a copy of the household's, scaled to your portion and checked against your own goals, allergies and dislikes. It follows the shared plan until you change it yourself, and it replaces a plan of your own for that week, so it asks first.",
        ask: "Use our household plan for next week.",
      },
      {
        name: "leave_household",
        kind: "saves",
        asks: true,
        what: "Leaves the household. Your own copies of its plans stay yours but stop following it.",
        ask: "Leave the household.",
      },
      {
        name: "set_sharing",
        kind: "saves",
        asks: true,
        what: "Lets one friend see one kind of your data (workouts, consistency, templates or body), or stops. Each grant and withdrawal is recorded.",
        ask: "Let bo.lifts see my workouts.",
      },
      {
        name: "create_challenge",
        kind: "saves",
        what: "Starts a friendly challenge of 1 to 8 weeks that counts days: with a finished workout, with protein at or over each person's own goal, or with enough steps. Only a set number of days a week count, so a rest day never costs a point, and it is never about weight.",
        ask: "Start a 4-week challenge with bo.lifts: four training days a week.",
      },
      {
        name: "invite_to_challenge",
        kind: "saves",
        what: "Invites a friend to a challenge you made. They decide, and nothing of theirs is read until they accept.",
        ask: "Invite bo.lifts to the challenge.",
      },
      {
        name: "list_challenges",
        kind: "reads",
        what: "Shows your challenges with the rule, the dates and everyone's days counted, and invitations waiting for you. Each person is shown as a name or nickname and one number; a person who is not your friend appears as a participant unless they have a nickname.",
        ask: "How is the challenge going?",
      },
      {
        name: "accept_challenge",
        kind: "saves",
        what: "Joins a challenge you were invited to. Your days that meet the rule count and show to the others as one number, and you get one results email when it closes.",
        ask: "Join Ana's challenge.",
      },
      {
        name: "decline_challenge",
        kind: "saves",
        asks: true,
        what: "Turns down a challenge invitation and deletes it.",
        ask: "No thanks to that challenge.",
      },
      {
        name: "leave_challenge",
        kind: "saves",
        asks: true,
        what: "Leaves a challenge you joined. Your score goes with you.",
        ask: "Leave the challenge.",
      },
      {
        name: "cancel_challenge",
        kind: "saves",
        asks: true,
        what: "Cancels a challenge you made. It and every score in it are deleted for everyone.",
        ask: "Cancel my challenge.",
      },
      {
        name: "show_crew_feed",
        kind: "opens",
        what: "Opens your friends' recent workouts and streaks, only for what each friend shares with you, with a kudos button and the kudos on your own workouts. A workout where a friend beat their own best shows by exercise name, never with numbers.",
        ask: "What have my friends been up to?",
        shots: [{ name: "crew", alt: "The crew feed: three friends with the streaks they share, their recent workouts such as Push day with 6 exercises and 18 sets, a kudos button, and kudos on your own leg day" }],
      },
      {
        name: "send_to_friend",
        kind: "saves",
        what: "Sends a friend a copy of one of your saved workouts or recipes, or a whole week of your meal plan. They get it only if they accept, it never replaces anything of theirs, and nothing else about you becomes visible.",
        ask: "Send my push day to bo.lifts.",
      },
      {
        name: "list_received_items",
        kind: "reads",
        what: "Lists the workouts and recipes friends sent you that you have not answered.",
        ask: "Did anyone send me anything?",
      },
      {
        name: "accept_received_item",
        kind: "saves",
        what: "Saves a copy of what a friend sent as your own. A name you already use gets a suffix instead of being replaced.",
        ask: "Accept the push day.",
      },
      {
        name: "decline_received_item",
        kind: "saves",
        asks: true,
        what: "Declines what a friend sent. Your friend is not told.",
        ask: "No thanks to that one.",
      },
      {
        name: "send_friend_invite",
        kind: "saves",
        asks: true,
        what: "Invites someone who is not on Fitwell yet, by email. Fitwell is invite-only, so each member has a few invitations a month.",
        ask: "Invite my friend at sam@example.com.",
      },
      {
        name: "list_friend_invites",
        kind: "reads",
        what: "Shows who you invited, whether they have joined, and how many invitations you have left.",
        ask: "Who have I invited?",
      },
      {
        name: "cancel_friend_invite",
        kind: "saves",
        asks: true,
        what: "Takes back an invitation nobody has used.",
        ask: "Cancel the invitation to sam@example.com.",
      },
    ],
  },
  {
    id: "data",
    title: "Your data",
    blurb: "It is yours. Take it with you, remove one thing, or delete everything. Data is stored in the EU.",
    tools: [
      {
        name: "export_my_data",
        kind: "reads",
        what: "Everything Fitwell stores about you as one file: profile, goals, food, workouts, templates, weigh-ins, recipes, plans, friends, streaks and email choices.",
        ask: "Export all my data.",
      },
      {
        name: "delete_item",
        kind: "saves",
        asks: true,
        what: "Removes one thing you stored: a food entry, a workout, a template, a recipe, a meal plan, a weigh-in, measurements or a day's sleep, steps and water.",
        ask: "Delete yesterday's lunch.",
      },
      {
        name: "import_fitwell_backup",
        kind: "saves",
        what: "Gives you a one-time link to upload a backup from the old Fitwell web app, and imports it without overwriting what you already have.",
        ask: "I have a backup from the old app.",
      },
      {
        name: "delete_my_account",
        kind: "saves",
        asks: true,
        what: "Permanently erases everything and signs you out everywhere. It first offers you an export, and asks you to type a confirmation.",
        ask: "Delete my account.",
      },
    ],
  },
];

/** Tools that exist but are not listed above, on purpose: the player and the pages call them with buttons, and the owner's tools are only for the owner. */
export const UNLISTED_TOOLS: string[] = [
  // Called by the pages (not by your assistant), so they are not things to ask for.
  "get_exercise_guide",
  "get_workout",
  "log_set",
  "set_rest",
  "log_cardio_block",
  "set_exercise_note",
  "get_substitutes",
  "swap_exercise",
  "set_grocery_checked",
  "get_dashboard_data",
  "get_muscle_map",
  "get_review_data",
  "give_kudos",
  "get_today_data",
  "today_eat_planned",
  "today_quick_add",
  "today_add_water",
  "get_meal_plan_data",
  "plan_swap_recipe",
  "plan_copy_meal",
  "plan_repeat_day",
  "plan_eat_meal",
  // For the owner of the service only.
  "list_invite_requests",
  "list_invitations",
  "approve_invite_request",
  "decline_invite_request",
  "add_invitation",
  "remove_invitation",
];
