import { useEffect, useState } from 'preact/hooks';
import { firstDataAt } from '../../db/foodStore';
import { InstallCard } from '../settings/InstallCard';

/** On iPhone/iPad, once you have some history, a one-time nudge to add Fitwell to the Home Screen. */
export function InstallHint() {
  const [has, setHas] = useState(false);
  useEffect(() => void firstDataAt().then((t) => setHas(t !== undefined)), []);
  return has ? <InstallCard compact /> : null;
}
