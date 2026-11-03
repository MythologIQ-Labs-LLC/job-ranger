export function validateExternalUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Invalid external URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https links can be opened outside Sojourner.");
  }

  return parsed.toString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateId(rawValue: unknown, label: string): string {
  if (typeof rawValue !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  const normalized = rawValue.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${label} must be a numeric identifier.`);
  }

  return normalized;
}

export function validateOptionalString(rawValue: unknown, label: string): string | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  if (typeof rawValue !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return rawValue.trim();
}

export function validateBoolean(rawValue: unknown, label: string): boolean {
  if (typeof rawValue !== "boolean") {
    throw new Error(`${label} must be true or false.`);
  }
  return rawValue;
}

export function validateOptionalBoolean(rawValue: unknown, label: string): boolean | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  return validateBoolean(rawValue, label);
}

export function validateFiniteNumber(rawValue: unknown, label: string): number {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return rawValue;
}

export function validateIntegerInRange(
  rawValue: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number {
  const value = validateFiniteNumber(rawValue, label);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

export function validateStringArray(rawValue: unknown, label: string): string[] {
  if (!Array.isArray(rawValue)) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return rawValue.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new Error(`${label}[${index}] must be a string.`);
    }
    return entry.trim();
  });
}

export function validateOptionalStringArray(
  rawValue: unknown,
  label: string,
): string[] | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  return validateStringArray(rawValue, label);
}

export function validateNullableCompanyId(rawValue: unknown, label: string): string | null {
  if (rawValue === null) {
    return null;
  }
  return validateId(rawValue, label);
}

export function validateOptionalNullableCompanyId(
  rawValue: unknown,
  label: string,
): string | null | undefined {
  if (rawValue === undefined) {
    return undefined;
  }
  return validateNullableCompanyId(rawValue, label);
}
