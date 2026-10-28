/**
 * The only Trusted Types policy in the Sojourner web runtime. It mints
 * TrustedScriptURL values solely for same-origin JavaScript files belonging
 * to this deployment (the runtime worker and the service worker). The CSP
 * (`trusted-types job-ranger-script-url; require-trusted-types-for 'script'`)
 * forbids every other script-URL or HTML sink.
 */
export const TRUSTED_TYPES_POLICY_NAME = "job-ranger-script-url";

interface ScriptUrlPolicy {
  createScriptURL(url: string): unknown;
}

let policy: ScriptUrlPolicy | null = null;

function validateScriptUrl(url: string): string {
  const parsed = new URL(url, window.location.href);
  if (parsed.origin !== window.location.origin || !/\.(m?js)$/.test(parsed.pathname)) {
    throw new TypeError(`Blocked untrusted script URL: ${url}`);
  }
  return parsed.toString();
}

export function trustedScriptUrl(url: string): string {
  const factory = (window as unknown as {
    trustedTypes?: { createPolicy(name: string, rules: { createScriptURL(url: string): string }): ScriptUrlPolicy };
  }).trustedTypes;
  if (!factory) return validateScriptUrl(url);
  policy ??= factory.createPolicy(TRUSTED_TYPES_POLICY_NAME, { createScriptURL: validateScriptUrl });
  return policy.createScriptURL(url) as string;
}
