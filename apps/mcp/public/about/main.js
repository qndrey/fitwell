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
