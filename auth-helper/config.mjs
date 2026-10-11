/**
 * Safe unconfigured defaults for the separately hosted OAuth helper (#264).
 * A deployment system must set both *public* identifiers to approved values.
 * No client secret or OAuth bearer token belongs in this file.
 * Never configure the helper on the main Job Ranger application origin.
 */
export const GOOGLE_WEB_CLIENT_ID = "";
export const JOB_RANGER_APP_ORIGIN = "";
