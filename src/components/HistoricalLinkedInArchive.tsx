import { useEffect, useMemo, useState } from "react";
import { getDesktopApi } from "../services/api";
import {
  matchHistoricalPostsToLatestRanking,
  type HistoricalLinkedInPost, type HistoricalTextSource,
} from "../shared/linkedin-history";
import type { LinkedInReconciliationReport } from "../shared/linkedin-reconciliation";

/** A separate archive for POSTS PUBLISHED BEFORE Job Ranger reviewed them. */
export function HistoricalLinkedInArchive({ analytics }: {
  analytics: LinkedInReconciliationReport;
}) {
  const [posts, setPosts] = useState<HistoricalLinkedInPost[]>([]);
  const [url, setUrl] = useState("");
  const [publishedOn, setPublishedOn] = useState("");
  const [body, setBody] = useState("");
  const [textSource, setTextSource] = useState<HistoricalTextSource>("copied_from_post");
  const [acknowledged, setAcknowledged] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void getDesktopApi().personalBrand.listHistoricalLinkedInPosts()
      .then(items => { if (live) setPosts(items); })
      .catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Could not load historical posts."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  const matched = useMemo(() =>
    matchHistoricalPostsToLatestRanking(posts, analytics), [posts, analytics]);
  const byId = useMemo(() => new Map(matched.map(row => [row.historicalId, row])), [matched]);

  async function save() {
    if (!acknowledged || busy) return;
    setBusy(true); setError(null); setNotice("");
    try {
      await getDesktopApi().personalBrand.recordHistoricalLinkedInPost({
        url, publishedOn, body, textSource,
      }, true);
      setPosts(await getDesktopApi().personalBrand.listHistoricalLinkedInPosts());
      setUrl(""); setPublishedOn(""); setBody("");
      setTextSource("copied_from_post"); setAcknowledged(false);
      setNotice("Historical LinkedIn post saved as user-attested text, not a reviewed publishing receipt.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save historical post.");
    } finally { setBusy(false); }
  }
  async function remove() {
    if (!deleteId || !deleteConfirmed || busy) return;
    setBusy(true); setError(null); setNotice("");
    try {
      await getDesktopApi().personalBrand.deleteHistoricalLinkedInPost(deleteId, true);
      setPosts(await getDesktopApi().personalBrand.listHistoricalLinkedInPosts());
      setDeleteId(""); setDeleteConfirmed(false);
      setNotice("Historical post deleted. Imported analytics and original publishing records are unchanged.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete historical post.");
    } finally { setBusy(false); }
  }

  return (
    <section data-testid="linkedin-historical-archive" aria-label="Historical LinkedIn post archive"
      className="rounded-xl border border-[var(--color-border)] p-4 space-y-4">
      <h3 className="font-semibold">Archive older LinkedIn posts</h3>
      <p className="text-sm text-[var(--color-text-secondary)]">
        For posts that Job Ranger did not prepare before publication. Paste the actual post URL,
        original date and text. LinkedIn's analytics export contains metrics, not post text or replies.
        Archived text is user-attested, not verified by LinkedIn or approved before publishing.
        Do not paste private messages, third-party comments or confidential material.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="block text-sm font-medium">Historical LinkedIn post permalink
          <input className="input-shell mt-1 w-full" type="url" value={url}
            placeholder="https://www.linkedin.com/posts/..."
            maxLength={1600} onChange={event => { setUrl(event.target.value); setAcknowledged(false); }} />
        </label>
        <label className="block text-sm font-medium">Original publication date (LinkedIn calendar day)
          <input className="input-shell mt-1 w-full" type="date" value={publishedOn}
            onChange={event => { setPublishedOn(event.target.value); setAcknowledged(false); }} />
        </label>
      </div>
      <label className="block text-sm font-medium">Historical post text
        <textarea className="input-shell mt-1 w-full min-h-32" value={body}
          maxLength={12000} onChange={event => { setBody(event.target.value); setAcknowledged(false); }}
          placeholder="Paste the text you actually published. Do not invent historical wording." />
      </label>
      <label className="block text-sm font-medium">How was this text obtained?
        <select className="input-shell mt-1 w-full" value={textSource}
          onChange={event => { setTextSource(event.target.value as HistoricalTextSource); setAcknowledged(false); }}>
          <option value="copied_from_post">Copied from my published post</option>
          <option value="reconstructed_from_memory">Reconstructed from memory (not exact)</option>
        </select>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={acknowledged}
          onChange={event => setAcknowledged(event.target.checked)} />
        <span>I confirm that this is my historical post and that the text and date are my own
          attestation. This does not verify LinkedIn content or career outcomes.</span>
      </label>
      <button type="button" className="primary-button" disabled={busy || loading || !acknowledged ||
        !url.trim() || !publishedOn || !body.trim()}
        onClick={() => { void save(); }}>
        Save historical LinkedIn post
      </button>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {loading ? <p role="status">Loading historical posts...</p> : (
        <>
          <p className="text-sm font-semibold">Historical archive ({posts.length} posts)</p>
          {!posts.length ? <p className="text-sm text-[var(--color-text-secondary)]">
            No historical posts archived yet.
          </p> : (
            <>
              <div className="max-h-96 overflow-y-auto space-y-3" tabIndex={0}
                aria-label="Saved historical LinkedIn posts">
                {posts.slice(0, 30).map(post => {
                  const linked = byId.get(post.id);
                  return (
                    <article key={post.id} className="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
                      <p className="text-sm font-semibold">
                        {post.publishedOn} · {post.textSource === "copied_from_post"
                          ? "User-attested copied text" : "Reconstructed text, not exact"}
                      </p>
                      <a href={post.url} target="_blank" rel="noopener noreferrer"
                        className="underline break-all text-xs">Original LinkedIn permalink</a>
                      <details>
                        <summary className="cursor-pointer text-sm">View manually recorded post text</summary>
                        <p className="mt-2 text-sm whitespace-pre-wrap break-words">{post.body}</p>
                      </details>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        Latest XLSX ranking: <strong>{linked?.status.replaceAll("-", " ") ?? "not evaluated"}</strong>.
                        {" "}{linked?.explanation ?? ""}
                      </p>
                      {linked?.status === "linked" && (
                        <p className="text-xs">
                          Impressions: {linked.impressions === null ? "Unknown" : linked.impressions.toLocaleString()};
                          {" "}engagements: {linked.engagements === null ? "Unknown" : linked.engagements.toLocaleString()}.
                          These are incomplete workbook rankings, not career outcomes.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
              {posts.length > 30 && <p className="text-xs">Showing the 30 most recently published archived posts.</p>}
              <label className="block text-sm font-medium">Select a historical post to delete
                <select className="input-shell mt-1 w-full" value={deleteId}
                  onChange={event => { setDeleteId(event.target.value); setDeleteConfirmed(false); }}>
                  <option value="">No post selected</option>
                  {posts.map(post=><option key={post.id} value={post.id}>
                    {post.publishedOn} · {post.url.slice(0, 90)}
                  </option>)}
                </select>
              </label>
              <label className="flex gap-2 items-start text-sm">
                <input type="checkbox" checked={deleteConfirmed}
                  onChange={event => setDeleteConfirmed(event.target.checked)} />
                <span>I confirm deletion of this user-attested historical post.</span>
              </label>
              <button type="button" className="secondary-button"
                disabled={!deleteId || !deleteConfirmed || busy}
                onClick={() => { void remove(); }}>Delete historical post</button>
            </>
          )}
        </>
      )}
    </section>
  );
}
