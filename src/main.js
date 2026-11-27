document.getElementById('yr').textContent = new Date().getFullYear();

var burger = document.getElementById('burger');
var links = document.getElementById('navLinks');
burger.addEventListener('click', function () {
  var open = links.classList.toggle('open');
  burger.setAttribute('aria-expanded', open ? 'true' : 'false');
});
links.addEventListener('click', function (e) {
  if (e.target.tagName === 'A') links.classList.remove('open');
});

var io = new IntersectionObserver(function (entries) {
  entries.forEach(function (en) {
    if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(function (el) { io.observe(el); });

// Contact form: Turnstile (explicit render) + POST to the Worker at /api/contact.
var form = document.getElementById('reqForm');
var statusEl = document.getElementById('reqStatus');
var submitBtn = form.querySelector('button[type="submit"]');
var widgetId;

window.onTurnstileLoad = function () {
  widgetId = window.turnstile.render('#reqTurnstile', {
    sitekey: import.meta.env.VITE_TURNSTILE_SITEKEY,
    action: 'contact',
    theme: 'dark',
    appearance: 'interaction-only' // hidden unless Cloudflare needs the visitor to click
  });
};

// Load Turnstile only when the contact form is near the screen or being used.
// It is the heaviest download on the page, so it should not delay first load.
var turnstileRequested = false;
function loadTurnstile() {
  if (turnstileRequested) return;
  turnstileRequested = true;
  var s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit';
  s.async = true;
  document.head.appendChild(s);
}
if ('IntersectionObserver' in window) {
  var tio = new IntersectionObserver(function (entries) {
    if (entries.some(function (en) { return en.isIntersecting; })) { tio.disconnect(); loadTurnstile(); }
  }, { rootMargin: '600px 0px' });
  tio.observe(form);
} else {
  loadTurnstile();
}
form.addEventListener('focusin', loadTurnstile, { once: true });

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = 'form-status' + (kind ? ' ' + kind : '');
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  var data = new FormData(form);
  if (!data.get('cf-turnstile-response')) {
    loadTurnstile();
    setStatus('Still verifying your browser \u2014 please try again in a moment.', 'err');
    return;
  }
  submitBtn.disabled = true;
  setStatus('Sending\u2026');
  try {
    var res = await fetch('/api/contact', { method: 'POST', body: data });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || json.ok !== true) throw new Error(json.error || 'Submission failed');
    form.reset();
    setStatus('Thank you \u2014 your request has been sent. We\u2019ll be in touch shortly.', 'ok');
  } catch (err) {
    setStatus((err && err.message) || 'Something went wrong. Please call or text 513-410-3772.', 'err');
  } finally {
    submitBtn.disabled = false;
    if (widgetId !== undefined) window.turnstile.reset(widgetId); // tokens are single-use
  }
});
