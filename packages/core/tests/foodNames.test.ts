import { describe, expect, it } from 'vitest';
import { friendlyFoodName } from '../src/domain/foodNames';

describe('friendlyFoodName', () => {
  it.each([
    ['Chicken, breast, flesh and skin, raw', 'Chicken breast with skin, raw'],
    ['Chicken, flesh and skin, raw', 'Chicken with skin, raw'],
    ['Chicken, breast, raw', 'Chicken breast, raw'],
    ['Cheese, semihard, Feta, 40 % fidm', 'Cheese, semihard, Feta, 40% fat in dry matter'],
    ['Cheese, firm, Fynbo, 45 % fidm.', 'Cheese, firm, Fynbo, 45% fat in dry matter'],
    ['Cocoa, instant, med milk, powder', 'Cocoa, instant, with milk, powder'],
    ['Milk, whole, konventional (not organic), 3.5 % fat', 'Milk, whole, conventional (not organic), 3.5% fat'],
    ['Strawberry, raw', 'Strawberry, raw'],
    ['Cod, fillet, smoked, with skin', 'Cod fillet with skin, smoked'],
  ])('%s', (raw, nice) => expect(friendlyFoodName(raw)).toBe(nice));
});
