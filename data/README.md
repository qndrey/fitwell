# Raw data inputs (not committed)

`data/raw/` is gitignored. To rebuild `src/data/generated/foods.frida.json`:

1. Download **Frida_5.5_Dataset.xlsx** (12.3 MB, CC BY 4.0, DTU National Food Institute,
   DOI 10.11583/DTU.29500682): https://ndownloader.figshare.com/files/60901603
   Expected SHA-256: `6b1952a35df3c0d4d7b2699ae0a3e377add42b231108309329b40256ef600e5e`
2. Save it as `data/raw/frida/Frida_5.5_Dataset.xlsx`.
3. `npm run build:foods` (deterministic; the output hash of the source is recorded in the JSON).

Documentation (English PDF): https://ndownloader.figshare.com/files/60901597
