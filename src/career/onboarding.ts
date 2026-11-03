import { useCallback, useEffect, useState } from "react";

const onboardingDismissedKey = "sojourner.onboarding.dismissed.v1";
const onboardingEvent = "sojourner:onboarding-preference-changed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(onboardingDismissedKey) === "true";
  } catch {
    return false;
  }
}

export function useOnboardingPreference() {
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    const handleChange = () => setDismissed(readDismissed());
    window.addEventListener(onboardingEvent, handleChange);
    window.addEventListener("storage", handleChange);
    return () => {
      window.removeEventListener(onboardingEvent, handleChange);
      window.removeEventListener("storage", handleChange);
    };
  }, []);

  const dismiss = useCallback(() => {
    window.localStorage.setItem(onboardingDismissedKey, "true");
    setDismissed(true);
    window.dispatchEvent(new CustomEvent(onboardingEvent));
  }, []);

  return { dismissed, dismiss };
}
