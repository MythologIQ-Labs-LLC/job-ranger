# Career Stories

Issue: #65

## Purpose

Career Stories organize confirmed Career Evidence into reusable narrative structures for interviews, networking, and later application-material workflows.

A Career Story is not factual authority. It is user-authored framing around one or more Career Evidence records.

The intended relationship is:

`Career Evidence -> Career Story -> interview/networking/application context`

Never:

`Career Story -> new Career Evidence`

## Story structure

A story may contain:

- title;
- tags;
- situation;
- challenge;
- action;
- result;
- reflection;
- explicit links to Career Evidence.

The narrative fields may be incomplete. Sojourner should not require every user to remember experience in a perfect STAR template before the story is useful.

A story must link to at least one current `user-confirmed` or `user-authored` Career Evidence item when it is created or updated.

## Evidence authority

Career Evidence remains the only factual career authority.

Story prose is user-authored narrative framing. Future consumers may use a story to understand which facts belong together, which themes matter, or how the user prefers to explain an experience. They may not treat story prose as proof of a factual claim.

Any future resume, cover-letter, application-answer, or generated material using a Career Story must re-ground factual claims to the linked current Career Evidence and pass the same truth boundary used elsewhere in Sojourner.

## Evidence changes

Career Evidence may be corrected, rejected, merged, or superseded after a Career Story is created.

Sojourner does not silently rewrite story evidence links.

If a linked evidence record is no longer current:

1. the story remains readable;
2. the linked evidence is marked stale;
3. explicit `supersedes` lineage is followed to find current successor evidence when available;
4. current successors are shown as suggestions;
5. the user must explicitly edit the story and choose current evidence before the stale state clears.

This preserves both historical intent and current factual authority without pretending an old story was authored against facts that did not yet exist.

## Storage

Career Stories use their own projection table and an explicit story-to-evidence link table.

Story rows store narrative framing only. They do not duplicate Career Evidence payloads as canonical facts.

Evidence links use foreign keys. Deleting a story cascades its links but never deletes Career Evidence. Linked Career Evidence is protected from physical deletion by the story link; normal evidence correction uses verification state and explicit lineage rather than destructive deletion.

## Inference boundary

No inference provider is required for Career Stories.

A future optional inference provider may propose:

- story titles or tags;
- clearer organization of situation/challenge/action/result/reflection;
- interview questions associated with a story;
- evidence-bound phrasing suggestions.

It may not:

- establish new Career Evidence;
- add unsupported metrics, outcomes, responsibilities, credentials, or experience;
- silently replace stale evidence links;
- convert story prose into factual authority;
- bypass the truth boundary of a downstream application artifact.

## Validation

Repository health must prove:

- input is bounded and requires at least one evidence link;
- only current confirmed/user-authored evidence can be linked on save;
- story state survives restart;
- superseding evidence marks an existing story stale;
- a current successor is suggested through explicit lineage but not auto-linked;
- an explicit edit can repair the link and clear stale state;
- deleting a story cascades story links without deleting Career Evidence.

Electron E2E must prove the same user workflow through the ordinary desktop UI.
