import { sendMessage } from "./utils/messaging";

export default defineContentScript({
  matches: [
    "https://*.signin.aws/platform/*",
    "https://*.awsapps.com/start/*",
    "https://device.sso.af-south-1.amazonaws.com/*",
    "https://device.sso.ap-east-1.amazonaws.com/*",
    "https://device.sso.ap-northeast-1.amazonaws.com/*",
    "https://device.sso.ap-northeast-2.amazonaws.com/*",
    "https://device.sso.ap-northeast-3.amazonaws.com/*",
    "https://device.sso.ap-south-1.amazonaws.com/*",
    "https://device.sso.ap-southeast-1.amazonaws.com/*",
    "https://device.sso.ap-southeast-2.amazonaws.com/*",
    "https://device.sso.ap-southeast-3.amazonaws.com/*",
    "https://device.sso.ca-central-1.amazonaws.com/*",
    "https://device.sso.eu-central-1.amazonaws.com/*",
    "https://device.sso.eu-north-1.amazonaws.com/*",
    "https://device.sso.eu-south-1.amazonaws.com/*",
    "https://device.sso.eu-west-1.amazonaws.com/*",
    "https://device.sso.eu-west-2.amazonaws.com/*",
    "https://device.sso.eu-west-3.amazonaws.com/*",
    "https://device.sso.me-south-1.amazonaws.com/*",
    "https://device.sso.sa-east-1.amazonaws.com/*",
    "https://device.sso.us-east-1.amazonaws.com/*",
    "https://device.sso.us-east-2.amazonaws.com/*",
    "https://device.sso.us-gov-east-1.amazonaws.com/*",
    "https://device.sso.us-gov-west-1.amazonaws.com/*",
    "https://device.sso.us-west-1.amazonaws.com/*",
    "https://device.sso.us-west-2.amazonaws.com/*",
  ],
  main(ctx) {
    const observer = new MutationObserver(checkUserCode);
    observer.observe(document, { childList: true, subtree: true, characterData: true });
    ctx.onInvalidated(() => observer.disconnect());
    checkUserCode();

    function checkUserCode() {
      const codeElement = document.querySelector("#user-code, .device-verification-user-code");
      const button = document.querySelector<HTMLElement>(
        '#cli_verification_btn, [data-testid="query-param-user-code"] [data-testid="test-primary-button"] button[type="submit"]',
      );
      const code = codeElement?.textContent?.trim();
      if (codeElement && code && button) {
        observer.disconnect();
        void confirmUserCode(codeElement, code, button);
      }
    }
  },
});

async function confirmUserCode(codeElement: Element, code: string, button: HTMLElement) {
  const isCurrent = () => codeElement.isConnected && codeElement.textContent?.trim() === code && button.isConnected;
  const banner = document.createElement("div");
  banner.textContent = "Granted is confirming your code automatically...";
  banner.style.position = "fixed";
  banner.style.top = "0";
  banner.style.width = "100%";
  banner.style.backgroundColor = "#25a749";
  banner.style.color = "white";
  banner.style.textAlign = "center";
  banner.style.padding = "10px";
  banner.style.zIndex = "1000";
  banner.style.fontFamily =
    "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
  document.body.prepend(banner);

  try {
    const validCodes = await sendMessage("getValidUserCodes", undefined);
    if (!validCodes.includes(code)) {
      throw new Error("This code doesn't match any valid codes from the Granted CLI.");
    }
    if (!isCurrent()) return;
    await sendMessage("setUserCode", code);
    if (isCurrent()) {
      button.click();
    }
  } catch (error) {
    console.error("Granted: couldn't confirm user code", error);
    banner.textContent = "Couldn't confirm this code with the Granted CLI. Close this tab and run your Granted command again.";
    banner.style.backgroundColor = "red";
    button.setAttribute("disabled", "true");
    button.style.cursor = "not-allowed";
    button.classList.remove("awsui-button-variant-primary");
  }
}
