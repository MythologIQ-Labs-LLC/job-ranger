/**
 * Microsoft Store package identity resolution for electron-builder.store.cjs.
 * Kept separate so the identity rules are unit-testable (tests/store-packaging-config.test.cjs).
 */
const VALIDATION_IDENTITY = Object.freeze({
  identityName: "Sojourner.PackageValidation",
  publisher: "CN=Sojourner Package Validation",
  publisherDisplayName: "Sojourner (package validation build)",
  displayName: "Sojourner (validation)",
});

function resolveStoreIdentity(env = process.env) {
  const configured = {
    identityName: env.SOJOURNER_STORE_IDENTITY_NAME?.trim() || "",
    publisher: env.SOJOURNER_STORE_PUBLISHER?.trim() || "",
    publisherDisplayName: env.SOJOURNER_STORE_PUBLISHER_DISPLAY_NAME?.trim() || "",
  };
  const provided = Object.values(configured).filter(Boolean).length;
  const requireIdentity = env.SOJOURNER_REQUIRE_STORE_IDENTITY === "1";

  if (provided > 0 && provided < 3) {
    throw new Error(
      "Microsoft Store identity is only partially configured. Provide SOJOURNER_STORE_IDENTITY_NAME, SOJOURNER_STORE_PUBLISHER, and SOJOURNER_STORE_PUBLISHER_DISPLAY_NAME together.",
    );
  }
  if (provided === 0) {
    if (requireIdentity) {
      throw new Error(
        "A Microsoft Store submission package requires the Partner Center identity (SOJOURNER_STORE_IDENTITY_NAME, SOJOURNER_STORE_PUBLISHER, SOJOURNER_STORE_PUBLISHER_DISPLAY_NAME).",
      );
    }
    return { ...VALIDATION_IDENTITY, kind: "validation" };
  }
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(configured.identityName)) {
    throw new Error("SOJOURNER_STORE_IDENTITY_NAME must be 3-50 characters of letters, digits, periods, or dashes.");
  }
  if (!/^CN=/.test(configured.publisher)) {
    throw new Error("SOJOURNER_STORE_PUBLISHER must be the Partner Center publisher distinguished name (starting with CN=).");
  }
  return {
    ...configured,
    displayName: env.SOJOURNER_STORE_DISPLAY_NAME?.trim() || "Sojourner",
    kind: "store",
  };
}

module.exports = { resolveStoreIdentity, VALIDATION_IDENTITY };
