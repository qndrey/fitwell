// The shape the shopping view draws. Pure types, shared with the view (which can't see server code).

/** The shape the shopping view draws; items carry whether they are ticked. */
export interface ShoppingData {
  weekStart: string;
  people: number;
  meals: number;
  sections: { aisle: string; items: { key: string; name: string; grams: number; buy: string; cooked?: true; usedIn: string[]; checked: boolean }[] }[];
  itemCount: number;
  leftToBuy: number;
  leftOut: string[];
  notes: string[];
}

