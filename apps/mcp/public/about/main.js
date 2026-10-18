// Copy buttons on the "How to join" steps: copy the address, or select it when the clipboard is not allowed.
(function () {
  function wire(buttonId, codeId, outId) {
    var btn = document.getElementById(buttonId);
    var code = document.getElementById(codeId);
    var out = document.getElementById(outId);
    if (!btn || !code || !out) return;
    btn.addEventListener('click', function () {
      function selectIt() {
        var r = document.createRange();
        r.selectNodeContents(code);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        out.textContent = 'Selected: press copy on your keyboard.';
      }
      try {
        navigator.clipboard.writeText(code.textContent).then(function () { out.textContent = 'Copied.'; }, selectIt);
      } catch { selectIt(); }
    });
  }
  wire('copy', 'connector', 'copied');
  wire('copy-email', 'invite-email', 'copied-email');
})();

// Theme: follow the system, or force light or dark (kept in this browser only).
(function () {
  var btn = document.getElementById('theme');
  if (!btn) return;
  var order = ['auto', 'light', 'dark'];
  var mode = 'auto';
  try { mode = window.localStorage.getItem('fitwell-about-theme') || 'auto'; } catch { /* storage blocked: stay on auto */ }
  if (order.indexOf(mode) < 0) mode = 'auto';
  function apply() {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    btn.textContent = 'Theme: ' + mode;
    btn.setAttribute('aria-label', 'Colour theme: ' + mode + '. Press to change.');
  }
  btn.addEventListener('click', function () {
    mode = order[(order.indexOf(mode) + 1) % order.length];
    try { window.localStorage.setItem('fitwell-about-theme', mode); } catch { /* ignore */ }
    apply();
  });
  apply();
})();

// Carousels: the arrows move by one screenshot, and are disabled at either end.
(function () {
  document.querySelectorAll('.carousel').forEach(function (c) {
    var track = c.querySelector('.track');
    var prev = c.querySelector('.car-prev');
    var next = c.querySelector('.car-next');
    if (!track || !prev || !next) return;
    function step() { var f = track.querySelector('figure'); return f ? f.getBoundingClientRect().width + 20 : 300; }
    function update() {
      prev.disabled = track.scrollLeft <= 4;
      next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    }
    prev.addEventListener('click', function () { track.scrollBy({ left: -step() }); });
    next.addEventListener('click', function () { track.scrollBy({ left: step() }); });
    track.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  });
})();
