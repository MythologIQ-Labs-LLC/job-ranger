import { useCallback, useEffect, useMemo, useState } from "react";
import { getDesktopApi } from "../services/api";
import type { ManualPublicationReceipt } from "../shared/personal-brand";
import type { HistoricalLinkedInPost } from "../shared/linkedin-history";
import type { LinkedInTopicEvent, TopicTarget } from "../shared/linkedin-topics";

/** Explicit human classifications. Never treat an analytics metric as a topic label. */
export function LinkedInTopicAttestations({ publications,onLabelsChanged }:{
  publications: readonly ManualPublicationReceipt[];
  onLabelsChanged?: () => void;
}) {
  const [historical,setHistorical]=useState<HistoricalLinkedInPost[]>([]);
  const [labels,setLabels]=useState<LinkedInTopicEvent[]>([]);
  const [targetKey,setTargetKey]=useState("");
  const [entry,setEntry]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState("");
  const [history,setHistory]=useState<LinkedInTopicEvent[]>([]);

  const refresh=useCallback(async()=>{
    const api=getDesktopApi().personalBrand;
    const [posts,events]=await Promise.all([
      api.listHistoricalLinkedInPosts(),api.listLinkedInTopicLabels(),
    ]);
    setHistorical(posts);setLabels(events);
  },[]);
  useEffect(()=>{
    let live=true;
    void refresh().catch(cause=>{
      if(live)setError(cause instanceof Error?cause.message:"Could not load topic labels.");
    }).finally(()=>{if(live)setLoading(false);});
    return ()=>{live=false;};
  },[refresh]);
  const targets=useMemo(()=>[
    ...publications.filter(p=>p.destination==="linkedin").map(p=>({
      key:"confirmed_publication:"+p.postId,
      label:"Reviewed publication · "+p.publishedAt.slice(0,10)+" · "+p.publishedUrl,
    })),
    ...historical.map(p=>({
      key:"historical_post:"+p.id,
      label:(p.textSource==="copied_from_post"?"Historical copied text":"Historical reconstructed text")+
        " · "+p.publishedOn+" · "+p.url,
    })),
  ],[publications,historical]);
  const selected=useMemo(()=>{
    const found=targets.find(t=>t.key===targetKey);
    if(!found)return null;
    const sep=targetKey.indexOf(":");
    return {targetKind:targetKey.slice(0,sep),targetId:targetKey.slice(sep+1)} as TopicTarget;
  },[targetKey,targets]);
  const current=useMemo(()=>labels.find(e=>e.targetKind===selected?.targetKind &&
    e.targetId===selected.targetId),[labels,selected]);
  useEffect(()=>{
    setConfirmed(false);setError(null);setNotice("");
    setEntry(current?.topics.join("\n")??"");
    if(!selected){setHistory([]);return;}
    let live=true;
    void getDesktopApi().personalBrand.listLinkedInTopicHistory(selected)
      .then(events=>{if(live)setHistory(events);})
      .catch(cause=>{if(live)setError(cause instanceof Error?cause.message:"Could not load topic revision history.");});
    return ()=>{live=false;};
  },[selected?.targetKind,selected?.targetId,current?.revision]);

  async function save(clear:boolean){
    if(!selected||!confirmed||busy)return;
    setBusy(true);setError(null);setNotice("");
    try{
      const topics=clear?[]:entry.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
      const event=await getDesktopApi().personalBrand.attestLinkedInTopics(
        {...selected,topics},current?.revision??0,true);
      await refresh();
      onLabelsChanged?.();
      setHistory(await getDesktopApi().personalBrand.listLinkedInTopicHistory(selected));
      setConfirmed(false);
      setNotice(event.action==="clear"?
        "Active topic labels cleared. Revision history is retained.":"Topic labels saved as user-attested classifications.");
    }catch(cause){
      setError(cause instanceof Error?cause.message:"Unable to attest topics.");
      setConfirmed(false);
    }finally{setBusy(false);}
  }
  return (
    <section data-testid="linkedin-topic-attestations" aria-label="User-attested LinkedIn topics"
      className="rounded-xl border border-[var(--color-border)] p-4 space-y-3">
      <h3 className="font-semibold">Classify published content by topic</h3>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Add your own labels to a confirmed LinkedIn publication or historical post.
        Topics do not come from the LinkedIn analytics export and are not guessed from text.
        Labels are editorial assertions, not evidence of performance or career outcomes.
      </p>
      {error && <p role="alert" className="text-sm text-[var(--color-danger)]">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {loading ? <p role="status" className="text-sm">Loading topic records...</p> : (
        <>
          <button type="button" className="secondary-button" onClick={()=>{
            setError(null);void refresh().catch(cause=>setError(String(cause)));
          }} disabled={busy}>Refresh available posts</button>
          <label className="block text-sm font-semibold">Choose an existing LinkedIn post
            <select className="input-shell mt-1 w-full" value={targetKey}
              onChange={event=>setTargetKey(event.target.value)}>
              <option value="">Choose a recorded post</option>
              {targets.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </label>
          {!targets.length && <p className="text-sm">No confirmed publications or historical posts to classify yet.</p>}
          {selected && (
            <>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Record type: {selected.targetKind==="historical_post"?"User-attested history":"Confirmed original publication"}.
                Current revision: {current?.revision??0}. Active labels: {current?.topics.length?
                  current.topics.join(", "):"None"}.
              </p>
              <label className="block text-sm font-semibold">Topics (one per line, maximum 6)
                <textarea className="input-shell mt-1 min-h-28 w-full" maxLength={400}
                  placeholder="Career change\nCustomer experience\nAI governance"
                  value={entry} onChange={event=>{setEntry(event.target.value);setConfirmed(false);}}/>
              </label>
              <label className="flex gap-2 text-sm items-start">
                <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
                <span>I personally reviewed these topic labels and confirm they are my own description.
                  Revisions remain in the local audit history even after clearing active labels.</span>
              </label>
              <div className="flex gap-2 flex-wrap">
                <button type="button" className="primary-button" disabled={busy||!confirmed||!entry.trim()}
                  onClick={()=>{void save(false);}}>Save reviewed topics</button>
                <button type="button" className="secondary-button"
                  disabled={busy||!confirmed||!current?.topics.length}
                  onClick={()=>{void save(true);}}>Clear active topic labels</button>
              </div>
              <details>
                <summary className="cursor-pointer text-sm font-semibold">
                  Topic revision history ({history.length})
                </summary>
                <ol className="mt-2 space-y-2 text-xs">
                  {history.map(e=><li key={e.id}>
                    Revision {e.revision} · {e.action} · {e.recordedAt} · {e.topics.join(", ")||"no active labels"}
                  </li>)}
                </ol>
              </details>
            </>
          )}
          <p className="text-xs text-[var(--color-text-secondary)]">
            Changing or clearing labels never modifies published copy, Career Evidence, imported analytics,
            or the Truth Gate. Deleting an archived historical post also purges its attached topic history.
            No automatic topic performance ranking is authorized.
          </p>
        </>
      )}
    </section>
  );
}
