---
name: tech-writing-style
description: Write, rewrite, or review technical prose for clarity and human readability. Applies Google technical-writing guidance and checks language-model drafts for overloaded sentences, punctuation-heavy clause chains, inline-list overload, unexplained terminology, formulaic contrast, canned transitions, unsupported claims, and repetitive rhetoric. Use for technical writing of any content type, including work governed by another documentation skill.
---

# Technical writing style

## 1. Purpose and limits

Use this skill to make prose clear, precise, and natural across technical content types. It governs expression, not the content or structure required by an architecture decision record, tutorial, reference page, or another content-specific skill. Apply content and format skills alongside it.

This skill is neither an artificial-intelligence detector nor a generic humanizer. Diagnose reader-facing problems without guessing who or what wrote the text. Do not inject personality, opinion, or stylistic quirks to make prose appear human.

Preserve technical meaning and evidence boundaries. Use this precedence order:

1. Preserve facts, source meaning, and explicit user requirements.
2. Follow project terminology and house style.
3. Follow the structure required by a content-specific skill.
4. Apply this skill's prose defaults.

Source integrity applies at every level. House style never justifies a fabricated quotation or unsupported claim.

### Operating modes

Infer the mode from the request. A direct request to edit calls for edited text, not a style lecture.

| Mode | Behavior |
|---|---|
| Write | Apply the rules while drafting. Do not announce the skill or narrate its checks. |
| Rewrite | Return improved prose. Preserve facts, uncertainty, normative force, identifiers, code, quotations, and user intent. Report claims that need verification instead of inventing support. |
| Review | Return prioritized findings, ordered by integrity, meaning, structure, and local style. For each finding, quote the exact passage, explain the reader risk, and propose a concrete revision. Separate integrity blockers from style improvements. Omit harmless pattern matches. Never produce an authorship score or accusation. |

## 2. Meaning and evidence guardrails

Run this pass first because every later edit depends on it.

- Preserve technical facts, causal relationships, conditions, exceptions, and scope.
- Preserve normative strength. Do not change `must`, `should`, `may`, or equivalent terms merely to improve tone.
- Preserve exact code identifiers, paths, commands, user-interface labels, error text, and direct quotations.
- Preserve uncertainty when evidence is incomplete. When possible, attach a hedge to its condition or the missing evidence.
- Never invent a definition, metric, example result, citation, quotation, consensus, or causal explanation.
- Verify quotations and attributed claims against an available source.
- Narrow, cite, flag, or remove claims that the source does not support.
- Qualify a load-bearing use of `current`, `new`, or `today` with a version or date.

When evidence is unavailable, state what needs verification. A fluent rewrite cannot repair an integrity failure.

## 3. Audience and terminology pass

- Infer the likely reader from the request and the existing document.
- Define or link an unfamiliar term at its first point of need.
- Spell out an unfamiliar acronym at first use when the acronym recurs enough to help.
- Do not create an acronym used only a few times.
- Use one term for one concept. Do not rotate synonyms for variety.
- Clarify ambiguous pronouns, especially bare `this`, `that`, `it`, or `they` after multiple possible referents.
- Keep specialist terms that the audience expects. Do not replace precision with a vague plain-language substitute.

## 4. Sentence and clause pass

Use information structure, not sentence length alone, as the main test.

- Give each sentence one main job.
- Name the actor and use a direct verb when the actor matters.
- Prefer active voice. Keep passive voice when the actor is unknown, irrelevant, or intentionally de-emphasized.
- Split a clause that introduces a separate claim, condition, consequence, or rationale.
- Keep clauses together when their grammatical relationship conveys necessary logic.
- Put an applicable condition before its instruction.
- Replace noun-heavy abstractions with actors and verbs when the process itself is not the topic.
- Replace a generic participial tail such as `..., improving reliability` with a testable mechanism or consequence.
- Remove filler, empty intensifiers, and unsupported promotional adjectives.
- Vary cadence only when meaning benefits. Avoid both fragment chains and a series of identical short sentences.

A sentence longer than 35 words is a review warning. Inspect its hierarchy, but do not split it solely because of its length.

## 5. Punctuation and embedded-structure pass

Punctuation must express an already clear relationship. It must not let one sentence avoid choosing an information hierarchy.

Treat these patterns as review warnings:

- More than one em dash in a paragraph.
- Two or more semicolons in one sentence.
- Three or more comma-separated items in prose.
- Nested or load-bearing parenthetical content.

When a warning fires, inspect the logic. Use separate sentences, a precise conjunction, a colon, a list, or a table when that form exposes the relationship better.

Keep an em dash for a genuine break or interruption. Keep a semicolon when it clearly joins two closely related complete thoughts. Keep a short parenthetical for a minor aside, abbreviation, or example. Do not replace punctuation mechanically, and never describe a dash or semicolon as evidence of model authorship.

## 6. Lists, paragraphs, and headings pass

- Use bullets for three or more unordered items when readers need to compare, count, scan, or act on them.
- Use numbers only when sequence or priority matters.
- Use a table when each item has the same attributes.
- Introduce a list or table with enough context.
- Keep list items parallel in grammar and logical category.
- Keep a short inline series when converting it would fragment ordinary prose.
- Give each paragraph one topic and state that topic early.
- Review a paragraph longer than roughly 120 words for a useful split.
- Combine a run of thin one-sentence paragraphs when they form one explanation.
- Use descriptive headings with a valid hierarchy.
- Merge headings that govern only one sentence or repeat the paragraph's opening.
- Avoid a bold pseudo-heading on every list item or paragraph.
- Treat labels such as `A1`, `A1a`, or `P7` as warnings unless the document defines the taxonomy.

Do not impose an arbitrary heading count or paragraph character limit.

## 7. Language-model pattern pass

Use these patterns only as editing prompts. Context, repetition, and reader harm determine whether a passage needs revision. None of the patterns proves model authorship.

| Pattern to inspect | Reader risk | Preferred revision | Legitimate use |
|---|---|---|---|
| Repeated `X, not Y`, `not just`, `not only`, or `rather than` frames | Manufactured contrast implies a misconception and creates a slogan-like cadence. | State the mechanism or result directly. | Keep a contrast when the rejected alternative is real and salient. |
| Canned transitions and stage directions, such as `Additionally`, `Moreover`, `In conclusion`, `It is important to note`, `let's explore`, `as you can see`, or `this section will` | Empty signposting delays the point and hides the actual relationship. | Delete it or name the relationship with a precise transition such as `because`, `however`, or `after`. | Keep a transition that expresses a real logical or temporal relationship. |
| Repetitive conclusions | A recap that restates preceding material delays useful information. | Delete the recap. | Keep a conclusion that synthesizes implications, records a decision, or gives a next action. |
| Inflated or promotional language, such as `seamless`, `robust`, `transformative`, or `pivotal` | Praise substitutes for testable information. | State the mechanism, scope, comparison, or evidence. | A requested persuasive genre may use persuasive tone, but its technical claims still need support. |
| Hedging and intensifier stacks | Vague strength and stacked uncertainty conceal confidence and scope. | Tie uncertainty to a reason, condition, interval, or missing test. Use measurements when the source provides them. | Preserve a hedge that accurately bounds incomplete evidence. |
| Uniform rhetorical templates | Repeated rules of three, identical paragraph shapes, uplifting summaries, or participial endings flatten emphasis and invite filler. | Organize around actual dependencies and evidence. | Keep parallel structure when it makes comparable information easier to scan. |
| Forced synonym changes | Synonym rotation suggests distinctions that do not exist. | Repeat the exact technical term. | Use a different term only when it names a real distinction. |
| Excessive headings, bold labels, fragments, emoji, or thematic breaks | Decorative formatting fragments the explanation and weakens hierarchy. | Keep only formatting that communicates hierarchy or conforms to house style. | Fragments and emphasis can be correct in interfaces, tables, warnings, and parallel lists. |
| Second-person meta commentary | Stage directions talk about the document instead of the task or system. | Remove commentary about what the document will show. | Keep `you` and imperatives for actions the reader performs. |
| Fake quotations or quotation-shaped paraphrases | Invented words, speakers, or context mislead the reader. | Verify the exact words, speaker, and context. Quote accurately, paraphrase with support, or remove the claim. | Use a verified quotation when the exact wording matters. |
| Vague attribution or unsupported consensus | Phrases such as `experts say` conceal the source and overstate the evidence. | Name the source and evidence. Narrow or remove any broader claim. | A sourced consensus statement is valid when the evidence supports that scope. |
| Generic gap-filling or superficial causal claims | Fluent speculation can turn missing information into a false fact or mechanism. | Find source support and state the mechanism. If support is unavailable, mark the gap. | Clearly bounded hypotheses are useful when labeled and relevant. |
| Choppy cadence or repeated sentence openings | Monotony obscures sequence, causality, and emphasis. | Combine sentences only when the relationship matters; otherwise revise the opening or order. | Use short sentences for decisions and warnings. |

Also inspect repeated uses of `rejected outright`, `for free`, `clearly`, and `obviously`. Revise them when they add confidence or drama without evidence. Do not use a word blacklist.

## Examples

Each example changes the information structure only as much as the stated evidence allows.

### Clause-heavy sentence

**Before:** The worker retries failed requests—unless the deadline has passed—and writes each attempt to the audit stream; if one zone fails, another replica serves the audit data, improving reliability.

**After:** If a failed request's deadline has not passed, the worker retries it. The worker writes each attempt to the audit stream. If one zone fails, another replica serves the audit data. This failover keeps the audit stream available during a single-zone failure.

The revision separates the condition, action, and consequence. It replaces the vague participial claim with the stated failure mechanism.

### Inline list

**Before:** Before release, verify the changelog, confirm the release owner, check the license notices, record the rollback contact, and review the monitoring dashboard.

**After:** Complete these checks before release:

- Verify the changelog.
- Confirm the release owner.
- Check the license notices.
- Record the rollback contact.
- Review the monitoring dashboard.

The list exposes five actions and keeps them parallel.

### Formulaic contrast

**Before:** The scheduler is not just faster; it is smarter, not reactive. It is not only a queue but a foundation for scale.

**After:** The scheduler orders jobs by deadline and available capacity.

The revision states the mechanism without unsupported praise. Keep this legitimate contrast unchanged when the distinction matters: `The cache is a latency optimization, not the source of truth.`

### Unexplained term

**Before:** Enable ripple mode to reduce idle time.

**After, with a source-backed definition:** Enable ripple mode, which starts the next batch before every response in the current batch arrives, to reduce idle time.

**After, when the source has no definition:** `[Verification needed: Define "ripple mode" and explain how it reduces idle time.]`

Do not invent the definition to make the sentence read smoothly.

### Integrity failure

**Before:** Experts agree that the service is secure, and its designer said it is “impossible to breach.”

**After:** `[Verification required: Identify evidence for the security claim and verify the quotation, speaker, and context. Narrow or remove both claims if no source supports them.]`

A style edit cannot validate an attribution or quotation.

### Real uncertainty

**Before:** The patch may potentially improve throughput when requests share cached metadata, though we have not tested this condition.

**After:** The patch may improve throughput when requests share cached metadata, but we have not benchmarked that condition.

The revision removes stacked hedging while preserving the condition and missing test.

### Legitimate punctuation

Keep these sentences unchanged when the surrounding context is clear:

- `The deployment has one blocker—the unsigned image.`
- `If the cache entry is absent, fetch the record from the database; otherwise, return the cached value.`

The em dash marks a concise break. The semicolon joins two branches of the same condition.

## 8. Final silent check

Before returning prose, check:

1. Does every sentence have one clear job?
2. Can the reader identify actors, conditions, and consequences?
3. Are terms defined and used consistently?
4. Should any embedded series become a list or table?
5. Is punctuation carrying too many clauses?
6. Did a contrast slogan, canned transition, recap, or promotional phrase survive without a purpose?
7. Does each paragraph have one topic and a useful opening sentence?
8. Are all quotations, attributions, facts, and measurements supported?
9. Did the edit preserve uncertainty, normative strength, and exact technical tokens?
10. Does the result sound natural when read aloud?

Run this check silently. Print it only when the user asks for the review method.
