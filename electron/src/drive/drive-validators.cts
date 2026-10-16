import type { DriveApproveRequest } from "../../../src/shared/google-drive.js";
import { validateCareerEntityId } from "../career-validators.cjs";
import { DriveError } from "./drive-errors.cjs";

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateDriveApproveRequest(value: unknown): DriveApproveRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DriveError("invalid_request", "Drive export request must be an object.");
  }
  const raw = value as Record<string, unknown>;
  if (typeof raw.expectedSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(raw.expectedSha256)) {
    throw new DriveError("invalid_request", "Drive export request needs the reviewed SHA-256.");
  }
  if (raw.saveAnotherCopy !== undefined && typeof raw.saveAnotherCopy !== "boolean") {
    throw new DriveError("invalid_request", "saveAnotherCopy must be true or false.");
  }
  if (typeof raw.expectedAccountId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(raw.expectedAccountId)) {
    throw new DriveError("invalid_request", "Drive export request needs the reviewed Google account.");
  }
  return {
    expectedAccountId: raw.expectedAccountId,
    artifactId: validateCareerEntityId(raw.artifactId, "Resume artifact id"),
    expectedSha256: raw.expectedSha256.toLowerCase(),
    saveAnotherCopy: raw.saveAnotherCopy === true,
  };
}

export function validateConnectFlowId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !OPERATION_ID.test(value)) {
    throw new DriveError("invalid_request", "Invalid Google sign-in id.");
  }
  return value.toLowerCase();
}

export function validateDriveOperationId(value: unknown): string {
  if (typeof value !== "string" || !OPERATION_ID.test(value)) {
    throw new DriveError("invalid_request", "Invalid Drive export operation id.");
  }
  return value.toLowerCase();
}
