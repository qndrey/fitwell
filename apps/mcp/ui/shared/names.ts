/** "Barbell Bench Press - Medium Grip" → "Barbell Bench Press": the variant after the dash is noise in a row or a tile. */
export const shortName = (name: string) => name.split(' - ')[0]!.replace(/\s*\(.*\)\s*$/, '').trim();
