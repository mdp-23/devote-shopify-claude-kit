// The forms walk's rules, without a store. Run with: node --test tests/
//
// The first cases are the two forms one rebuild lost (28 Oct 2026). If you change a rule in
// scripts/qa/forms-walk.mjs, change its case here in the same commit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formSignatures, formAppScripts, formIssues, pagesFromSitemap } from "../scripts/qa/forms-walk.mjs";

const page = (html) => ({ signatures: formSignatures(html, { siteHost: "www.acme.com" }), apps: formAppScripts(html) });
const KLAVIYO_JS = '<script src="https://static.klaviyo.com/onsite/js/AbCdEf/klaviyo.js"></script>';

test("an email-platform form swapped for a Shopify contact form fails", () => {
  const live = page(`${KLAVIYO_JS}<div class="klaviyo-form-QwErTy"></div>`);
  const preview = page(`${KLAVIYO_JS}<form action="/contact"><input type="hidden" name="form_type" value="contact"></form>`);
  const issues = formIssues("/pages/apply", live, preview);
  assert.equal(issues.length, 1);
  assert.match(issues[0].msg, /Klaviyo form QwErTy/);
});

test("a footer sign-up that became a Shopify customer form fails", () => {
  const live = page('<footer><div class="klaviyo-form-ZxCvBn"></div></footer>');
  const preview = page('<footer><form><input type="hidden" name="form_type" value="customer"></form></footer>');
  assert.equal(formIssues("/", live, preview).length, 1);
});

test("a rebuilt form that declares the destination it posts to passes", () => {
  const live = page('<div class="klaviyo-form-ZxCvBn"></div>');
  const preview = page('<form data-replaces-form="klaviyo:ZxCvBn"><input type="hidden" name="form_type" value="customer"></form>');
  assert.deepEqual(formIssues("/", live, preview), []);
});

test("the same embed on both passes, extra forms on the preview are fine", () => {
  const live = page('<div class="klaviyo-form-QwErTy"></div>');
  const preview = page('<div class="klaviyo-form-QwErTy"></div><form><input type="hidden" name="form_type" value="contact"></form>');
  assert.deepEqual(formIssues("/pages/apply", live, preview), []);
});

test("the form app's script missing from the preview fails even with no embed on the page", () => {
  const issues = formIssues("/", page(KLAVIYO_JS), page(""));
  assert.equal(issues.length, 1);
  assert.match(issues[0].msg, /app embed/);
});

test("third-party form hosts and off-site actions are destinations", () => {
  const sigs = formSignatures('<iframe src="https://form.jotform.com/123456"></iframe><form action="https://hooks.example.org/in"></form>', { siteHost: "www.acme.com" });
  assert.deepEqual(sigs, ["action:hooks.example.org/in", "embed:form.jotform.com/123456"]);
});

test("theme chrome forms are not compared", () => {
  const sigs = formSignatures('<input type="hidden" name="form_type" value="product"><input type="hidden" name="form_type" value="localization"><form action="/cart/add"></form>', { siteHost: "www.acme.com" });
  assert.deepEqual(sigs, []);
});

test("sitemap locations are read", () => {
  assert.deepEqual(pagesFromSitemap("<urlset><url><loc>https://www.acme.com/pages/a</loc></url><url><loc> https://www.acme.com/pages/b </loc></url></urlset>"), ["https://www.acme.com/pages/a", "https://www.acme.com/pages/b"]);
});
