import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

declare const chrome: typeof browser;

let context: BrowserContext;
let profile: string;

test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "granted-extension-"));
  const extension = resolve(".output/chrome-mv3");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
});

test.afterEach(async () => {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
});

async function nativeCodes(codes: string[] | null, fail = false, delay = 0) {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(({ codes, fail, delay }) => {
    // Mock only the external native host; exercise the built extension and its messaging.
    chrome.runtime.sendNativeMessage = async () => {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (fail) throw new Error("Native messaging host unavailable");
      return { codes: codes?.map(code => ({ code, expiresAt: "2099-01-01T00:00:00Z" })) };
    };
  }, { codes, fail, delay });
}

const layouts = [
  {
    name: "regional sign-in",
    url: "https://ap-southeast-2.signin.aws/platform/d-example/login",
    html: `<h2>Authorization Request</h2>
      <div data-testid="query-param-user-code">
        <div class="device-verification-user-code"> ABCD-EFGH </div>
        <awsui-button data-testid="test-primary-button"><button type="submit">Confirm and continue</button></awsui-button>
      </div>`,
  },
  {
    name: "AWS access portal",
    url: "https://example.awsapps.com/start/",
    html: `<h2>Authorization requested</h2><div id="user-code">ABCD-EFGH</div>
      <button id="cli_verification_btn">Confirm and continue</button>`,
  },
  {
    name: "legacy device sign-in",
    url: "https://device.sso.ap-southeast-2.amazonaws.com/",
    html: `<div id="user-code">ABCD-EFGH</div>
      <button id="cli_verification_btn">Confirm and continue</button>`,
  },
];

for (const layout of layouts) {
  test(`${layout.name}: confirms only a matching local code`, async () => {
    await nativeCodes(["ABCD-EFGH"]);
    const page = await context.newPage();
    await page.route(layout.url, route => route.fulfill({ contentType: "text/html", body: `
      <body><form onsubmit="event.preventDefault()">${layout.html}</form>
      <script>document.querySelector('button').onclick = () => document.body.dataset.confirmed = 'yes';</script></body>` }));
    await page.goto(layout.url);
    await expect(page.locator("body")).toHaveAttribute("data-confirmed", "yes");
  });
}

for (const scenario of ["mismatched", "missing", "unavailable"] as const) {
  test(`regional sign-in: blocks confirmation when local codes are ${scenario}`, async () => {
    await nativeCodes(scenario === "mismatched" ? ["WXYZ-QRST"] : null, scenario === "unavailable");
    const page = await context.newPage();
    const layout = layouts[0];
    await page.route(layout.url, route => route.fulfill({ contentType: "text/html", body: layout.html }));
    await page.goto(layout.url);
    await expect(page.getByRole("button", { name: "Confirm and continue" })).toBeDisabled();
    await expect(page.getByText(/doesn't match|Couldn't confirm/)).toBeVisible();
  });
}

test("regional sign-in: waits for the client-rendered confirmation form", async () => {
  await nativeCodes(["ABCD-EFGH"]);
  const page = await context.newPage();
  const layout = layouts[0];
  await page.route(layout.url, route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(layout.url);
  await page.waitForTimeout(300);
  await page.evaluate(html => {
    document.body.innerHTML = html;
    document.querySelector("button")!.onclick = () => { document.body.dataset.confirmed = "yes"; };
  }, layout.html);
  await expect(page.locator("body")).toHaveAttribute("data-confirmed", "yes");
});

test("access approval requires a verified code in the same tab", async () => {
  await nativeCodes(["ABCD-EFGH"]);
  const page = await context.newPage();
  const layout = layouts[0];
  await page.route(layout.url, route => route.fulfill({ contentType: "text/html", body: `
    ${layout.html}<script>document.querySelector('button').onclick = () => document.body.dataset.confirmed = 'yes';</script>` }));
  await page.goto(layout.url);
  await expect(page.locator("body")).toHaveAttribute("data-confirmed", "yes");

  const consentUrl = "https://example.awsapps.com/start/consent";
  await context.route(consentUrl, route => route.fulfill({ contentType: "text/html", body: `
    <h2>Allow access to your data?</h2><button data-testid="allow-access-button"
      onclick="document.body.dataset.approved = 'yes'">Allow access</button>` }));
  const unverified = await context.newPage();
  await unverified.goto(consentUrl);
  await page.goto(consentUrl);
  await expect(page.locator("body")).toHaveAttribute("data-approved", "yes");
  await expect(unverified.getByText("Granted is confirming your access automatically...")).toBeVisible();
  await expect(unverified.locator("body")).not.toHaveAttribute("data-approved", "yes");
});

test("a code changed during native verification does not authorize later access", async () => {
  await nativeCodes(["ABCD-EFGH"], false, 500);
  const page = await context.newPage();
  const layout = layouts[0];
  await page.route(layout.url, route => route.fulfill({ contentType: "text/html", body: layout.html }));
  await page.goto(layout.url);
  await expect(page.getByText("Granted is confirming your code automatically...")).toBeVisible();
  await page.locator(".device-verification-user-code").evaluate(el => { el.textContent = "WXYZ-QRST"; });
  await page.waitForTimeout(700);
  const consentUrl = "https://example.awsapps.com/start/consent";
  await page.route(consentUrl, route => route.fulfill({ contentType: "text/html", body: `
    <h2>Allow access to your data?</h2><button data-testid="allow-access-button"
      onclick="document.body.dataset.approved = 'yes'">Allow access</button>` }));
  await page.goto(consentUrl);
  await expect(page.getByText("Granted is confirming your access automatically...")).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator("body")).not.toHaveAttribute("data-approved", "yes");
});
