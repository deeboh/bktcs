const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

const CONTACT_TO = "info@bktcs.com";
const CONTACT_FROM = { email: "website@bktcs.com", name: "Black Tie Website" };
const TURNSTILE_ACTION = "contact";

// Field name -> [label, max length, required]
const FIELDS = {
  name: ["Name", 120, true],
  company: ["Company", 160, false],
  phone: ["Phone", 40, true],
  email: ["Email", 254, true],
  date: ["Signing date", 20, false],
  type: ["Signing type", 40, false],
  address: ["Property", 300, false],
  notes: ["Notes", 4000, false],
};

// URLs that used to exist (e.g. an old version of the site) and are gone for good.
// These return 410 so search engines drop them; everything else unknown is 404.
// Exact paths, or prefixes ending in "/*".
const GONE_PATHS = [
  "/a/*",
];

const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...SECURITY_HEADERS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "bktcs.com") {
      url.hostname = "www.bktcs.com";
      return Response.redirect(url.toString(), 301);
    }

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === "/api/contact") {
      if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleContact(request, env);
    }

    const res = await env.ASSETS.fetch(request);
    if (res.status === 404) return notFound(url.pathname, request.method);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    if (res.ok) {
      out.headers.set("cache-control", url.pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable" // hashed filenames from Vite
        : "public, max-age=300");
    }
    return out;
  },
};

async function handleContact(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid submission." }, 400);
  }

  // Honeypot: real visitors never see this field. Pretend success for bots.
  if (String(form.get("website") ?? "").trim()) return json({ ok: true });

  const ip = request.headers.get("cf-connecting-ip") ?? "";
  if (!(await verifyTurnstile(form.get("cf-turnstile-response"), ip, env))) {
    return json({ ok: false, error: "Verification failed. Please try again." }, 403);
  }

  const values = {};
  for (const [key, [label, max, required]] of Object.entries(FIELDS)) {
    const v = String(form.get(key) ?? "").trim();
    if (required && !v) return json({ ok: false, error: `${label} is required.` }, 400);
    if (v.length > max) return json({ ok: false, error: `${label} is too long.` }, 400);
    values[key] = v;
  }
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(values.email)) {
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  }

  const rows = Object.entries(FIELDS)
    .filter(([key]) => key !== "notes")
    .map(([key, [label]]) => [label, values[key] || "—"]);

  const text = [
    ...rows.map(([l, v]) => `${l}: ${v}`),
    "",
    "Notes:",
    values.notes || "—",
  ].join("\n");

  const html = `<h2 style="font-family:Georgia,serif">New signing request</h2>
<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">
${rows.map(([l, v]) => `<tr><td style="color:#666"><b>${esc(l)}</b></td><td>${esc(v)}</td></tr>`).join("\n")}
</table>
<p style="font-family:Arial,sans-serif;font-size:14px"><b>Notes</b><br>${esc(values.notes || "—").replace(/\n/g, "<br>")}</p>`;

  try {
    await env.EMAIL.send({
      from: CONTACT_FROM,
      to: CONTACT_TO,
      replyTo: { email: values.email, name: values.name },
      subject: `Signing request - ${values.name}`.replace(/[\r\n]+/g, " "),
      text,
      html,
    });
  } catch (err) {
    console.error("contact email failed", err?.code, err?.message);
    return json({ ok: false, error: "We couldn't send your request. Please call or text 513-410-3772." }, 502);
  }

  return json({ ok: true });
}

async function verifyTurnstile(token, ip, env) {
  const hostnames = new Set(
    String(env.TURNSTILE_HOSTNAMES ?? "").split(",").map((h) => h.trim()).filter(Boolean),
  );
  if (typeof token !== "string" || !token || token.length > 2048 || !env.TURNSTILE_SECRET || hostnames.size === 0) {
    return false;
  }

  let result;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip }),
    });
    if (!r.ok) throw new Error(`siteverify ${r.status}`);
    result = await r.json();
  } catch (err) {
    console.error("turnstile siteverify failed", err?.message);
    return false; // fail closed
  }

  if (result.success !== true) return false;

  // Turnstile's public test keys return no action and hostname "example.com".
  // Only accepted when explicitly enabled (local .dev.vars), never in production.
  if (result.metadata?.result_with_testing_key && env.TURNSTILE_ALLOW_TEST_KEYS === "true") return true;

  return result.action === TURNSTILE_ACTION && hostnames.has(result.hostname);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function isGone(path) {
  return GONE_PATHS.some((p) => (p.endsWith("/*") ? path.startsWith(p.slice(0, -1)) : path === p));
}

function notFound(path, method) {
  const gone = isGone(path);
  const status = gone ? 410 : 404;
  const title = gone ? "This page has been removed" : "Page not found";
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} | Black Tie Closing Service</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b0d;color:#e9e6df;font:16px/1.6 Georgia,serif;text-align:center;padding:1rem}
h1{font-weight:400;letter-spacing:.04em;margin:0 0 .5rem}p{color:#a9a6a0;margin:0 0 1.5rem}
a{color:#c9a227;text-decoration:none;border-bottom:1px solid #c9a227}</style></head>
<body><main><h1>${title}</h1><p>${status}</p><a href="/">Return to Black Tie Closing Service</a></main></body></html>`;
  return new Response(method === "HEAD" ? null : body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // 410s are permanent, so cache them; never cache 404s so new pages appear immediately.
      "cache-control": gone ? "public, max-age=300" : "no-store",
      ...SECURITY_HEADERS,
    },
  });
}
