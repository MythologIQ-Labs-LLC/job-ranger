import assert from "node:assert/strict";
import { test } from "node:test";
import { uploadApprovedDriveFile, findCreatedDriveFile, DRIVE_OPERATION_PROPERTY, DriveTransportError } from "../src/pwa/drive/google-drive-transport.ts";

const secret = "NEVER_LOG_A_PROVIDER_TOKEN";
const document = new Blob(["Sojourner verified PDF test bytes"], { type: "application/pdf" });
const digest = async (blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("");
const good = async () => ({
  accessToken: secret,
  operationId: "op_314_verified_1",
  destinationId: "folder_123",
  name: "Sojourner-Resume.pdf",
  mimeType: "application/pdf",
  bytes: document,
  approvedSha256: await digest(document),
});
const remote = {
  id: "driveFile_123", name: "Sojourner-Resume.pdf",
  mimeType: "application/pdf", parents: ["folder_123"],
  size: String(document.size),
  appProperties: { [DRIVE_OPERATION_PROPERTY]: "op_314_verified_1" },
};
const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

function driver(responses) {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url: String(url), options });
    const response = responses.shift();
    if (response instanceof Error) throw response;
    assert.ok(response, "Unexpected network request");
    return response;
  };
  return { requests, fetchMock };
}

test("only one authorized POST creates the approved app-owned file, followed by exact metadata and byte readback", async () => {
  const { requests, fetchMock } = driver([json({ id: remote.id }), json(remote), new Response(document)]);
  const input = await good();
  const result = await uploadApprovedDriveFile(input, fetchMock);
  assert.deepEqual(result, {
    status: "verified", remoteId: remote.id, name: input.name,
    sha256: input.approvedSha256, openUrl: "https://drive.google.com/file/d/driveFile_123/view",
  });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(x => x.options.method ?? "GET"), ["POST", "GET", "GET"]);
  assert.ok(requests[0].url.startsWith("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart"));
  assert.ok(requests[1].url.includes("fields=id,name,mimeType,parents,size,appProperties"));
  assert.ok(requests[2].url.endsWith("alt=media"));
  for (const req of requests) {
    assert.equal(req.options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(req.options.redirect, "error");
    assert.equal(req.options.cache, "no-store");
    assert.equal(req.url.includes(secret), false);
  }
  const multipart = await requests[0].options.body.text();
  assert.match(multipart, /"parents":\["folder_123"\]/);
  assert.match(multipart, /"sojournerExportOperation":"op_314_verified_1"/);
  assert.match(multipart, /Sojourner verified PDF test bytes/);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("My Drive root alias resolves to an opaque folder ID before the first POST", async () => {
  const root = { id: "opaque_root_456", mimeType: "application/vnd.google-apps.folder" };
  const created = { ...remote, parents: [root.id] };
  const { requests, fetchMock } = driver([
    json(root), json({ id: remote.id }), json(created), new Response(document),
  ]);
  const result = await uploadApprovedDriveFile({ ...await good(), destinationId: "root" }, fetchMock);
  assert.equal(result.status, "verified");
  assert.equal(requests[0].url, "https://www.googleapis.com/drive/v3/files/root?fields=id,mimeType");
  assert.deepEqual(requests.map(x => x.options.method ?? "GET"), ["GET", "POST", "GET", "GET"]);
  assert.match(await requests[1].options.body.text(), /"parents":\["opaque_root_456"\]/);
});

test("if My Drive root cannot be verified, do not upload a single byte", async () => {
  const { requests, fetchMock } = driver([new Response("", { status: 403 })]);
  await assert.rejects(
    uploadApprovedDriveFile({ ...await good(), destinationId: "root" }, fetchMock),
    DriveTransportError,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method ?? "GET", "GET");
});

test("reject invalid filename, destination, MIME and changed document before any fetch", async () => {
  const invalid = [
    { name: "../secret.pdf" },
    { name: "bad.pdf/child" },
    { name: "report.exe" },
    { mimeType: "application/zip", name: "report.zip" },
    { destinationId: "https://drive.google.com/evil" },
    { operationId: "O'Reilly" },
    { approvedSha256: "0".repeat(64) },
  ];
  for (const changed of invalid) {
    const input = { ...await good(), ...changed };
    let count = 0;
    await assert.rejects(uploadApprovedDriveFile(input, async () => { count++; throw Error("network"); }), DriveTransportError);
    assert.equal(count, 0, JSON.stringify(changed));
  }
});

test("deny invalid token, oversized upload, unsupported MIME and newline in token", async () => {
  for (const change of [
    { accessToken: "bad\nheader" },
    { accessToken: "" },
    { mimeType: "application/vnd.google-apps.document" },
    { bytes: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]) },
  ]) {
    await assert.rejects(uploadApprovedDriveFile({ ...await good(), ...change }, async () => { throw Error("must not fetch"); }), DriveTransportError);
  }
});

test("401, 403 and 429 expose actionable categories, without retries or token leakage", async () => {
  for (const [status, category] of [[401,"action_needed"], [403,"denied"], [429,"quota"]]) {
    const { requests, fetchMock } = driver([new Response("", { status })]);
    await assert.rejects(uploadApprovedDriveFile(await good(), fetchMock), error => {
      assert.equal(error.category, category);
      assert.equal(error.message.includes(secret), false);
      return true;
    });
    assert.equal(requests.length, 1);
  }
});

test("unknown remote result after connection loss, server error or invalid acknowledgement never initiates retry", async () => {
  for (const responses of [
    [new Error("connection lost")],
    [new Response("", { status: 503 })],
    [new Response("not json")],
    [json({ id: "https://evil.example/file" })],
  ]) {
    const { requests, fetchMock } = driver(responses);
    const result = await uploadApprovedDriveFile(await good(), fetchMock);
    assert.deepEqual(result.status, "unknown_remote_outcome");
    assert.equal(result.remoteId, null);
    assert.equal(requests.length, 1);
  }
});

test("metadata mismatch or unreadable/mismatching remote bytes never claim verified", async () => {
  const scenarios = [
    [json({ ...remote, parents: ["unexpected"] }), new Response(document)],
    [json({ ...remote, appProperties: {} }), new Response(document)],
    [json({ ...remote, size: "0" }), new Response(document)],
    [json(remote), new Response("different bytes")],
    [json(remote), new Response("", { status: 403 })],
  ];
  for (const [metadata, media] of scenarios) {
    const { requests, fetchMock } = driver([json({ id: remote.id }), metadata, media]);
    const result = await uploadApprovedDriveFile(await good(), fetchMock);
    assert.equal(result.status, "verification_failed");
    assert.equal(result.remoteId, remote.id);
    assert.equal(requests.filter(x => x.options.method === "POST").length, 1);
  }
});

test("appProperties reconciliation is exact, scoped and never launches upload", async () => {
  const cases = [
    [json({ files: [remote] }), { status: "found", remoteId: remote.id }],
    [json({ files: [] }), { status: "not_confirmed" }],
    [json({ files: [remote, { ...remote, id: "other" }] }), { status: "ambiguous" }],
    [json({ files: [remote], nextPageToken: "next" }), { status: "ambiguous" }],
    [json({ files: [remote], incompleteSearch: true }), { status: "ambiguous" }],
  ];
  for (const [response, expected] of cases) {
    const { requests, fetchMock } = driver([response]);
    const result = await findCreatedDriveFile(secret, "op_314_verified_1", fetchMock);
    assert.deepEqual(result, expected);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method ?? "GET", "GET");
    assert.ok(new URL(requests[0].url).searchParams.get("q").includes(DRIVE_OPERATION_PROPERTY));
    assert.equal(requests[0].url.includes(secret), false);
  }
});
