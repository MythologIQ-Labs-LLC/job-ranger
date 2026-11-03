import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class AcquisitionNetworkPolicyError extends Error {
  readonly code = "acquisition-network-policy";

  constructor(message = "This source is not allowed by Sojourner's acquisition network policy.") {
    super(message);
    this.name = "AcquisitionNetworkPolicyError";
  }
}

export type AcquisitionHostResolver = (hostname: string) => Promise<string[]>;

export interface ApprovedAcquisitionTarget {
  url: string;
  hostname: string;
  addresses: string[];
}

const policyMessage =
  "This source is not allowed by Sojourner's acquisition network policy.";

function deny(): never {
  throw new AcquisitionNetworkPolicyError(policyMessage);
}

function ipv4Octets(address: string): number[] | null {
  if (isIP(address) !== 4) return null;
  const values = address.split(".").map(Number);
  return values.length === 4 && values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)
    ? values
    : null;
}

export function isPublicIpv4(address: string): boolean {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;

  return true;
}

function parseIpv6(address: string): number[] | null {
  let normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  if (isIP(normalized) !== 6) return null;

  const ipv4Match = normalized.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Match) {
    const ipv4 = ipv4Octets(ipv4Match[2]);
    if (!ipv4) return null;
    normalized = `${ipv4Match[1]}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}

export function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes) return false;

  const allZero = bytes.every((byte) => byte === 0);
  if (allZero) return false;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return false;

  if ((bytes[0] & 0xfe) === 0xfc) return false;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false;
  if (bytes[0] === 0xff) return false;

  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
    return false;
  }

  const mappedPrefix = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  if (mappedPrefix) {
    return isPublicIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }

  return true;
}

export function isPublicIpAddress(address: string): boolean {
  const normalized = address.replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) return isPublicIpv4(normalized);
  if (version === 6) return isPublicIpv6(normalized);
  return false;
}

export function validateAcquisitionUrlSyntax(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return deny();
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") deny();
  if (parsed.username || parsed.password) deny();

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost")) deny();

  const ipVersion = isIP(hostname);
  if (ipVersion && !isPublicIpAddress(hostname)) deny();

  return parsed;
}

export const resolveHostnamePublicAddresses: AcquisitionHostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true, verbatim: true });
  return Array.from(new Set(results.map((result) => result.address)));
};

export async function resolveApprovedAcquisitionTarget(
  rawUrl: string,
  resolver: AcquisitionHostResolver = resolveHostnamePublicAddresses,
): Promise<ApprovedAcquisitionTarget> {
  const parsed = validateAcquisitionUrlSyntax(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (isIP(hostname)) {
    return {
      url: parsed.toString(),
      hostname,
      addresses: [hostname],
    };
  }

  let addresses: string[];
  try {
    addresses = Array.from(new Set(await resolver(hostname)));
  } catch {
    return deny();
  }

  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address))) {
    return deny();
  }

  return {
    url: parsed.toString(),
    hostname,
    addresses,
  };
}

export async function assertPublicAcquisitionUrl(
  rawUrl: string,
  resolver: AcquisitionHostResolver = resolveHostnamePublicAddresses,
): Promise<string> {
  return (await resolveApprovedAcquisitionTarget(rawUrl, resolver)).url;
}
