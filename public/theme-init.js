/* Resolve the saved/system theme before the app or its styles paint. */
(function () {
  var preference = 'system';
  try { preference = localStorage.getItem('xhandle.darkMode') || 'system'; } catch (_) {}
  var dark = preference === 'dark';
  if (preference !== 'light' && preference !== 'dark') {
    try { dark = !!window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) {}
  }
  var root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1420' : '#ffffff');
}());
