import { signal } from '@preact/signals';

/** Ids of the open sheets, innermost last. Used so messages (toasts) appear *inside* the top sheet, where they can be tapped. */
export const sheetStack = signal<number[]>([]);
