// Avoids a theme flash before the app boots. The IndexedDB settings store is the source of truth.
try {
  var t = localStorage.getItem('fitwell-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
