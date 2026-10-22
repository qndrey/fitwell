// Tiny DOM helpers shared by the views (textContent only: names come from data, never parsed as HTML).
export type Child = Node | string | null | false | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & Record<string, unknown> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k.startsWith('aria-') || k.startsWith('data-') || k === 'role') el.setAttribute(k, String(v));
    else if (k === 'css' && typeof v === 'object') Object.assign(el.style, v); // CSSOM, not an inline style attribute (host CSP)
    else (el as unknown as Record<string, unknown>)[k] = v;
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

const NS = 'http://www.w3.org/2000/svg';
export function svg(tag: string, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) el.append(c);
  return el;
}
