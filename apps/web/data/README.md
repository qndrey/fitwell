# Raw data inputs (not committed)

`data/raw/` is gitignored. To rebuild `src/data/generated/foods.frida.json`:

1. Download **Frida_5.5_Dataset.xlsx** (12.3 MB, CC BY 4.0, DTU National Food Institute,
   DOI 10.11583/DTU.29500682): https://ndownloader.figshare.com/files/60901603
   Expected SHA-256: `6b1952a35df3c0d4d7b2699ae0a3e377add42b231108309329b40256ef600e5e`
2. Save it as `data/raw/frida/Frida_5.5_Dataset.xlsx`.
3. `npm run build:foods` (deterministic; the output hash of the source is recorded in the JSON).

## Exercises (free-exercise-db, The Unlicense)

1. Download `dist/exercises.json` (≈1 MB) pinned to commit `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5`:
   https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/dist/exercises.json
   Expected SHA-256: `5bb747e3fc658f095a60dcbf6d53c96627acdcc6ffb6fffde86f7e26995d40bf`
2. Save as `data/raw/exercises/exercises.json`, then `npm run build:exercises` (deterministic; images are not used).

Documentation (English PDF): https://ndownloader.figshare.com/files/60901597
