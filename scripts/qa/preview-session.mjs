// Which address the walks test, and the storefront password cookie that lets them in.
//
// Exists because one build's deploys ran every walk on https://<real domain>/?preview_theme_id=...
// while the store had not launched. The real domain still served the client's old site (not on
// Shopify), which ignores preview_theme_id, so SEO, widths, visual and speed all measured the old
// site and printed their results as the preview's. Before launch the preview only lives on the
// .myshopify.com address, behind the storefront password. deploy.mjs asks servesShopify() first:
// when the domain is not on Shopify, it unlocks the store with the password and every walk runs
// on the myshopify.com preview with that cookie (PREVIEW_COOKIE). No password means NOT CHECKED,
// never a walk against the old site.

const SHOPIFY_HEADERS = (h) => Boolean(h.get("x-shopid") || h.get("x-shopify-stage") || /shopify/i.test(h.get("powered-by") || ""));

/**
 * Whether https://<domain>/ is served by Shopify. Follows up to 3 redirects itself.
 * @returns {Promise<boolean|null>} true or false, or null when it could not be reached (unknown)
 */
export async function servesShopify(domain, { maxHops = 3 } = {}) {
  let url = `https://${String(domain).replace(/^https?:\/\//, "").replace(/\/$/, "")}/`;
  for (let hop = 0; ; hop++) {
    let r;
    try { r = await fetch(url, { redirect: "manual", headers: { "user-agent": "Mozilla/5.0 (Devote deploy)" } }); }
    catch { return null; }
    await r.arrayBuffer?.().catch(() => {});
    if (SHOPIFY_HEADERS(r.headers)) return true;
    const loc = r.headers.get("location");
    if (r.status >= 300 && r.status < 400 && loc && hop < maxHops) { url = new URL(loc, url).toString(); continue; }
    return false;
  }
}

/** Set-Cookie lines to a Cookie header: "name=value; name2=value2". */
export function cookiesFrom(setCookies) {
  return [].concat(setCookies || []).map((c) => String(c).split(";")[0].trim()).filter((c) => c.includes("=")).join("; ");
}

/**
 * Opens a password-protected store and returns the Cookie header that keeps it open.
 * Shopify keeps the unlock against the session cookie the password page hands out (there is no
 * storefront_digest cookie any more), so: fetch the password page for its cookies and form token,
 * post the password with them, then prove it worked by asking for the home page, which redirects
 * to /password while the store is still shut.
 * @returns {Promise<string>} the Cookie header; throws "storefront password rejected" otherwise
 */
export async function unlock(origin, password) {
  const base = origin.replace(/\/$/, "");
  const ua = { "user-agent": "Mozilla/5.0 (Devote deploy)" };
  const page = await fetch(`${base}/password`, { redirect: "manual", headers: ua });
  let cookie = cookiesFrom(page.headers.getSetCookie?.() || []);
  const html = page.text ? await page.text().catch(() => "") : "";
  const token = (html.match(/name="authenticity_token" value="([^"]+)"/) || [])[1];
  const body = `form_type=storefront_password&utf8=%E2%9C%93&password=${encodeURIComponent(password)}` + (token ? `&authenticity_token=${encodeURIComponent(token)}` : "");
  const post = await fetch(`${base}/password`, {
    method: "POST", redirect: "manual", body,
    headers: { ...ua, "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) },
  });
  cookie = mergeCookies(cookie, cookiesFrom(post.headers.getSetCookie?.() || []));
  const home = await fetch(`${base}/`, { redirect: "manual", headers: { ...ua, ...(cookie ? { cookie } : {}) } });
  cookie = mergeCookies(cookie, cookiesFrom(home.headers.getSetCookie?.() || []));
  const shut = home.status >= 300 && home.status < 400 && /\/password\b/.test(home.headers.get("location") || "");
  if (!cookie || shut || home.status >= 400) throw new Error("storefront password rejected");
  return cookie;
}

/**
 * True when Shopify answered with its storefront password page instead of the page asked for: the
 * store is shut and the cookie is missing or stale. A walk must report that page as NOT CHECKED,
 * never measure it and pass.
 */
export function onPasswordPage(url) {
  try { return /^\/password\/?$/.test(new URL(String(url)).pathname); } catch { return false; }
}

export function cookieHeader() {
  return process.env.PREVIEW_COOKIE || "";
}

/** Puts PREVIEW_COOKIE into a puppeteer page for url's host. Call before the first goto. */
export async function applyCookies(page, url) {
  const raw = cookieHeader();
  if (!raw || !/^https?:/.test(String(url))) return;
  const domain = new URL(url).hostname;
  const cookies = raw.split(/;\s*/).filter((p) => p.includes("=")).map((p) => {
    const i = p.indexOf("=");
    return { name: p.slice(0, i), value: p.slice(i + 1), domain, path: "/", secure: true };
  });
  if (cookies.length) await page.setCookie(...cookies);
}

/** Two Cookie headers as one; the later one wins for a name both carry. */
export function mergeCookies(...headers) {
  const m = new Map();
  for (const h of headers) for (const p of String(h || "").split(/;\s*/)) { const i = p.indexOf("="); if (i > 0) m.set(p.slice(0, i), p.slice(i + 1)); }
  return [...m].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Where the walks go. servesShopify is the answer from servesShopify(domain).
 *   on Shopify, or unknown: the preview on the real domain, as before
 *   not on Shopify yet:     the preview on the myshopify.com address, which needs the password;
 *                           liveUrl stays the old site (the forms and speed to compare with)
 */
export function walkTarget({ domain, store, theme, servesShopify, password }) {
  const liveUrl = `https://${domain}/`;
  if (servesShopify !== false) return { previewUrl: `https://${domain}/?preview_theme_id=${theme}`, liveUrl, prelaunch: false, needsPassword: false };
  if (!password) return { previewUrl: null, liveUrl, prelaunch: true, needsPassword: true };
  return { previewUrl: `https://${store}/?preview_theme_id=${theme}`, liveUrl, prelaunch: true, needsPassword: false };
}
