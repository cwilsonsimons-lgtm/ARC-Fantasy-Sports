import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatHeight, formatNumber, parseHeight, parseWeight } from '../core/height';
import { positionsOf } from '../core/positions';
import { describeDiff, findMatches, TIER_LABEL, type Candidate, type Tier } from '../core/match';
import { activeWorkspace, assign, AssignmentError, removeAssignment, restoreAssignment, reuseExactOn, updateSettings, usedMap, type Assignment, type GeneratedPlayer } from '../core/state';
import { HeightField, Modal, PositionSelect, plural, useStore, useToast } from './common';

export interface FindForm { position: string; height: string; weight: string }
export const emptyForm: FindForm = { position: '', height: '', weight: '' };

const signed = (n: number, unit: string) => (n === 0 ? `±0 ${unit}` : `${n > 0 ? '+' : '−'}${formatNumber(Math.abs(n))} ${unit}`);

export function FindMatch({ form, setForm }: { form: FindForm; setForm: (f: FindForm) => void }) {
  const { state, apply } = useStore();
  const toast = useToast();
  const ws = activeWorkspace(state);
  const { settings } = state;
  const [showUsed, setShowUsed] = useState(false);
  const [related, setRelated] = useState(false);
  const [shown, setShown] = useState(settings.resultLimit);
  const [relatedShown, setRelatedShown] = useState(settings.resultLimit);
  const [reviewing, setReviewing] = useState<Candidate | null>(null);
  const [done, setDone] = useState<Assignment | null>(null);
  const posRef = useRef<HTMLSelectElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const h = form.height.trim() ? parseHeight(form.height) : null;
  const w = form.weight.trim() ? parseWeight(form.weight) : null;
  const generated: GeneratedPlayer | null = form.position && h?.ok && w?.ok ? { position: form.position, heightIn: h.value, weight: w.value } : null;
  const used = usedMap(ws);

  const result = useMemo(
    () => generated && findMatches(generated, ws.prospects, new Set(used.keys()), { heightTol: settings.heightTol, weightTol: settings.weightTol, includeUsed: showUsed, reuseExact: reuseExactOn(settings), includeRelated: related }, settings),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [generated?.position, generated?.heightIn, generated?.weight, ws, settings, showUsed, related],
  );

  useEffect(() => { setShown(settings.resultLimit); setRelatedShown(settings.resultLimit); }, [generated?.position, generated?.heightIn, generated?.weight, settings.resultLimit]);
  useEffect(() => { if (done) nextRef.current?.focus(); }, [done]);

  const change = (patch: Partial<FindForm>) => { setDone(null); setForm({ ...form, ...patch }); };
  const ordered = result ? [...result.exact, ...result.preferred, ...result.fallback] : [];
  const visible = ordered.slice(0, shown);
  const firstSelectable = ordered.find((c) => !c.used || c.reusable);
  const openFirst = () => { if (firstSelectable) setReviewing(firstSelectable); };

  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => { if (focusTick) posRef.current?.focus(); }, [focusTick]);
  const matchNext = () => {
    setDone(null);
    setForm(emptyForm);
    setFocusTick((n) => n + 1); // focus once the cleared form has rendered
  };

  const undo = (a: Assignment) => {
    apply((s) => removeAssignment(s, a.id).state);
    setDone(null);
    toast(`Undid ${a.prospectName}. They're available again.`, {
      action: { label: 'Restore', run: () => { try { apply((s) => restoreAssignment(s, a)); } catch (e) { toast((e as Error).message, { tone: 'error' }); } } },
    });
  };

  // Tolerances must stay positive; anything else snaps back to the saved value.
  const tolerance = (key: 'heightTol' | 'weightTol', el: HTMLInputElement) => {
    const n = Number(el.value);
    if (Number.isFinite(n) && n > 0) apply((s) => updateSettings(s, { [key]: n }));
    else {
      el.value = String(settings[key]);
      toast('Tolerances must be greater than zero.', { tone: 'error' });
    }
  };

  const posLabel = form.position || 'player';
  const sameCount = ws.prospects.filter((p) => positionsOf(p.position).includes(form.position) && (showUsed || !used.has(p.id))).length;

  return (
    <section className="page" aria-labelledby="find-title">
      <div className="page-head">
        <h1 id="find-title">Find a Match</h1>
        <p className="lede">Enter the generated Madden prospect. Suggestions come only from your prospect pool in <b>{ws.name}</b>.</p>
      </div>

      <form className="card gen-form" onSubmit={(e) => { e.preventDefault(); openFirst(); }}>
        <div className="gen-grid">
          <PositionSelect id="gen-pos" value={form.position} onChange={(v) => change({ position: v })} positions={settings.positions} selectRef={posRef} onEnter={openFirst} />
          <HeightField id="gen-height" value={form.height} onChange={(v) => change({ height: v })} onEnter={openFirst} />
          <div className="field">
            <label htmlFor="gen-weight">Weight (lb)</label>
            <input id="gen-weight" value={form.weight} onChange={(e) => change({ weight: e.target.value })} inputMode="numeric" placeholder="215" autoComplete="off"
              className={w && !w.ok ? 'invalid' : ''} aria-describedby="gen-weight-hint" />
            <div id="gen-weight-hint" className={`hint ${w && !w.ok ? 'hint-error' : ''}`}>{w && !w.ok ? w.error : 'Pounds'}</div>
          </div>
        </div>
        <div className="gen-options">
          <div className="range-edit" role="group" aria-label="Preferred range">
            <span>Preferred range ±</span>
            <input aria-label="Height tolerance in inches" type="number" min="0.25" step="0.25" defaultValue={settings.heightTol} key={`h${settings.heightTol}`}
              onBlur={(e) => tolerance('heightTol', e.target)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), tolerance('heightTol', e.currentTarget))} />
            <span>in, ±</span>
            <input aria-label="Weight tolerance in pounds" type="number" min="1" step="1" defaultValue={settings.weightTol} key={`w${settings.weightTol}`}
              onBlur={(e) => tolerance('weightTol', e.target)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), tolerance('weightTol', e.currentTarget))} />
            <span>lb</span>
          </div>
          <label className="toggle"><input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} /> Show used prospects</label>
          <label className="toggle"><input type="checkbox" checked={related} onChange={(e) => setRelated(e.target.checked)} /> Include related positions</label>
          <button type="submit" className="btn btn-primary" disabled={!firstSelectable}>Review top match</button>
        </div>
        <p className="hint">Tip: press Enter in any field to review the top available suggestion. Nothing is assigned until you confirm.</p>
      </form>

      {done && (
        <div className="card success" role="status">
          <div>
            <div className="success-title">✓ Assigned <b>{done.prospectName}</b></div>
            <div className="muted">to the generated {done.generated.position}, {formatHeight(done.generated.heightIn)}, {done.generated.weight} lb{done.originalName ? ` (${done.originalName})` : ''}{done.team ? ` · ${done.team}` : ''}</div>
          </div>
          <div className="row-actions">
            <button className="btn" onClick={() => undo(done)}>Undo</button>
            <button className="btn btn-primary" ref={nextRef} onClick={matchNext}>Match Next Rookie →</button>
          </div>
        </div>
      )}

      {!done && !generated && (
        <div className="empty">
          {ws.prospects.length === 0
            ? <>Your prospect pool is empty. Import the Tankathon big board in <b>Prospect Pool</b> first.</>
            : <>Pick a position and enter height and weight to see ranked suggestions.</>}
        </div>
      )}

      {!done && generated && result && (
        <div className="results" aria-live="polite">
          <div className="results-head">
            <div>
              <h2>Suggestions for {generated.position} · {formatHeight(generated.heightIn)} · {generated.weight} lb</h2>
              <div className="muted">
                {plural(sameCount, `${showUsed ? '' : 'available '}${posLabel}`.trim(), `${showUsed ? '' : 'available '}${posLabel}s`.trim())} in pool ·{' '}
                {result.exact.length} exact · {result.preferred.length} within range · {result.fallback.length} outside
              </div>
            </div>
          </div>

          {result.exact.length + result.preferred.length === 0 && (
            <div className="notice notice-warn" role="alert">
              <b>No {showUsed ? '' : 'available '}{generated.position}s within your preferred range</b> (±{formatNumber(settings.heightTol)} in and ±{formatNumber(settings.weightTol)} lb).
              {result.fallback.length > 0 ? ' The closest options outside that range are shown below as fallbacks.' : ` There are no ${showUsed ? '' : 'available '}${generated.position}s in this pool at all.`}
            </div>
          )}

          {(['exact', 'preferred', 'fallback'] as Tier[]).map((tier) => {
            const items = visible.filter((c) => c.tier === tier);
            const total = result[tier].length;
            if (total === 0 && tier === 'fallback') return null;
            if (items.length === 0 && total > 0) return null;
            return (
              <div key={tier} className={`tier tier-${tier}`}>
                <h3 className="tier-title"><span className={`tier-dot dot-${tier}`} aria-hidden="true" />{TIER_NAME[tier]} <span className="muted">({total})</span></h3>
                <p className="tier-desc">{TIER_DESC[tier](settings.heightTol, settings.weightTol)}</p>
                {items.length === 0 ? <div className="tier-empty">None</div> : (
                  <ul className="cands">{items.map((c) => <CandidateCard key={c.prospect.id} c={c} usedBy={used.get(c.prospect.id)} onSelect={() => setReviewing(c)} />)}</ul>
                )}
              </div>
            );
          })}

          {ordered.length > shown && (
            <div className="more">
              <span className="muted">Showing {shown} of {ordered.length}</span>
              <button className="btn" onClick={() => setShown(shown + settings.resultLimit)}>Show {Math.min(settings.resultLimit, ordered.length - shown)} more</button>
              <button className="btn btn-ghost" onClick={() => setShown(ordered.length)}>Show all</button>
            </div>
          )}

          {related && (
            <div className="tier tier-related">
              <h3 className="tier-title"><span className="tier-dot dot-related" aria-hidden="true" />Related positions{result.relatedPositions.length ? ` (${result.relatedPositions.join(', ')})` : ''} <span className="muted">({result.related.length})</span></h3>
              <p className="tier-desc">Different positions you've marked as related in Settings. These are <b>not</b> exact-position matches; tiers inside this group use the same measurement rules.</p>
              {result.relatedPositions.length === 0 ? <div className="tier-empty">No related positions are set up for {generated.position}.</div>
                : result.related.length === 0 ? <div className="tier-empty">No prospects at related positions.</div>
                  : (
                    <>
                      <ul className="cands">{result.related.slice(0, relatedShown).map((c) => <CandidateCard key={c.prospect.id} c={c} usedBy={used.get(c.prospect.id)} onSelect={() => setReviewing(c)} />)}</ul>
                      {result.related.length > relatedShown && <div className="more"><button className="btn" onClick={() => setRelatedShown(relatedShown + settings.resultLimit)}>Show more related</button></div>}
                    </>
                  )}
            </div>
          )}

          <details className="explain">
            <summary>How suggestions are ranked</summary>
            <p>Only your selected position is searched (related positions appear separately when you turn them on). Prospects are grouped into tiers by hard limits — a prospect must be within <b>both</b> the height and weight limits to count as within range. Inside each tier they're ordered by:</p>
            <p className="formula">distance = |height difference| ÷ {formatNumber(settings.heightTol)} in + |weight difference| ÷ {formatNumber(settings.weightTol)} lb</p>
            <p>Lower is closer. Ties go to the smaller height difference, then the smaller weight difference, then name A–Z. The distance only compares listed measurements — it is not a probability and says nothing about talent or playing style. The range is never widened automatically.</p>
          </details>
        </div>
      )}

      {reviewing && generated && (
        <ReviewDialog
          c={reviewing}
          usedBy={used.get(reviewing.prospect.id)}
          generated={generated}
          onClose={() => setReviewing(null)}
          onConfirm={(extra) => {
            try {
              let made: Assignment | undefined;
              apply((s) => { const r = assign(s, { prospectId: reviewing.prospect.id, generated, ...extra, allowReuse: reviewing.reusable }); made = r.assignment; return r.state; });
              setReviewing(null);
              setDone(made!);
              return null;
            } catch (e) {
              return e instanceof AssignmentError ? e.message : `Couldn't assign: ${(e as Error).message}`;
            }
          }}
        />
      )}
    </section>
  );
}

const TIER_NAME: Record<Tier, string> = { exact: '1 · Exact match', preferred: '2 · Within preferred range', fallback: '3 · Outside preferred range (fallback)' };
const TIER_DESC: Record<Tier, (h: number, w: number) => string> = {
  exact: () => 'Same position, same height and same weight.',
  preferred: (h, w) => `Same position, height within ${formatNumber(h)} in and weight within ${formatNumber(w)} lb (limits included).`,
  fallback: () => 'Closest remaining same-position prospects. They miss at least one limit — use only if nothing above works.',
};

function CandidateCard({ c, usedBy, onSelect }: { c: Candidate; usedBy?: Assignment; onSelect: () => void }) {
  const p = c.prospect;
  return (
    <li>
      <button className={`cand ${c.used && !c.reusable ? 'cand-used' : ''}`} onClick={onSelect} disabled={c.used && !c.reusable} aria-label={`${p.name}, ${TIER_LABEL[c.tier]}${c.reusable ? ', already used, can reuse' : c.used ? ', used' : ''}`}>
        <div className="cand-main">
          <div className="cand-name">
            {p.name}
            {p.sample && <span className="badge badge-sample">Sample</span>}
          </div>
          <div className="cand-meta">{p.position}{c.related ? ' (related)' : ''}{p.college ? ` · ${p.college}` : ''}</div>
        </div>
        <div className="cand-meas">
          <span className="meas">{formatHeight(p.heightIn)}</span>
          <span className="meas">{formatNumber(p.weight)} lb</span>
        </div>
        <div className="cand-diff">
          <span className={`delta ${c.heightDiff === 0 ? 'delta-zero' : ''}`}>{signed(c.heightDiff, 'in')}</span>
          <span className={`delta ${c.weightDiff === 0 ? 'delta-zero' : ''}`}>{signed(c.weightDiff, 'lb')}</span>
          <div className="diff-text">{describeDiff(c.heightDiff, c.weightDiff)}</div>
        </div>
        <div className="cand-tags">
          <span className={`badge badge-${c.tier}`}>{TIER_LABEL[c.tier]}</span>
          <span className={`badge ${c.reusable ? 'badge-reuse' : c.used ? 'badge-used' : 'badge-avail'}`}>{c.reusable ? 'Used · can reuse' : c.used ? 'Used' : 'Available'}</span>
          <span className="dist" title="distance = |Δheight| ÷ height tolerance + |Δweight| ÷ weight tolerance. Lower is closer.">distance {c.distance.toFixed(2)}</span>
        </div>
        {c.used && usedBy && <div className="cand-usedby">{c.reusable ? 'Already used for' : 'Assigned to'} generated {usedBy.generated.position} {formatHeight(usedBy.generated.heightIn)} {usedBy.generated.weight} lb{usedBy.originalName ? ` (${usedBy.originalName})` : ''}{usedBy.team ? ` · ${usedBy.team}` : ''}. {c.reusable ? 'Exact match, so you can use this name again.' : 'Undo that assignment to reuse.'}</div>}
      </button>
    </li>
  );
}

function ReviewDialog({ c, usedBy, generated, onClose, onConfirm }: {
  c: Candidate; usedBy?: Assignment; generated: GeneratedPlayer; onClose: () => void;
  onConfirm: (extra: { originalName?: string; team?: string; notes?: string }) => string | null;
}) {
  const [originalName, setOriginalName] = useState('');
  const [team, setTeam] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const p = c.prospect;
  const submit = (e?: React.FormEvent) => { e?.preventDefault(); setError(onConfirm({ originalName, team, notes })); };
  return (
    <Modal
      title="Review assignment"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Back to suggestions</button>
          <button className="btn btn-primary" form="review-form" type="submit">Confirm assignment</button>
        </>
      }
    >
      <form id="review-form" onSubmit={submit}>
        <div className="compare">
          <div className="compare-col">
            <div className="compare-label">Generated Madden player</div>
            <div className="compare-name">{originalName.trim() || 'Unnamed rookie'}</div>
            <div className="compare-meas">{generated.position} · {formatHeight(generated.heightIn)} · {formatNumber(generated.weight)} lb</div>
          </div>
          <div className="compare-arrow" aria-hidden="true">→</div>
          <div className="compare-col compare-real">
            <div className="compare-label">Rename after</div>
            <div className="compare-name">{p.name}{p.sample && <span className="badge badge-sample">Sample</span>}</div>
            <div className="compare-meas">{p.position}{p.college ? ` · ${p.college}` : ''} · {formatHeight(p.heightIn)} · {formatNumber(p.weight)} lb</div>
          </div>
        </div>
        <div className="review-diff">
          <span className={`badge badge-${c.tier}`}>{TIER_LABEL[c.tier]}{c.related ? ' (related position)' : ''}</span>
          <span>Compared with the generated player: <b>{describeDiff(c.heightDiff, c.weightDiff)}</b></span>
          <span className="dist">distance {c.distance.toFixed(2)}</span>
        </div>
        {c.reusable && (
          <div className="notice notice-warn">
            <b>{c.prospect.name}</b> is already the name of another rookie in this workspace
            {usedBy ? ` (generated ${usedBy.generated.position}, ${formatHeight(usedBy.generated.heightIn)}, ${usedBy.generated.weight} lb${usedBy.originalName ? `, originally ${usedBy.originalName}` : ''}${usedBy.team ? `, ${usedBy.team}` : ''})` : ''}.
            They match this player exactly, so confirming uses the name again.
          </div>
        )}
        {c.tier === 'fallback' && <div className="notice notice-warn">This prospect is outside your preferred range.</div>}
        {c.related && <div className="notice notice-warn">This prospect plays a different position ({p.position}) than the generated player ({generated.position}).</div>}
        {p.notes && <p className="muted">Prospect notes: {p.notes}</p>}
        <div className="form-grid">
          <div className="field">
            <label htmlFor="rv-orig">Generated player's original name <span className="opt">optional</span></label>
            <input id="rv-orig" value={originalName} onChange={(e) => setOriginalName(e.target.value)} autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="rv-team">Madden team <span className="opt">optional</span></label>
            <input id="rv-team" value={team} onChange={(e) => setTeam(e.target.value)} autoComplete="off" />
          </div>
          <div className="field field-full">
            <label htmlFor="rv-notes">Notes <span className="opt">optional</span></label>
            <input id="rv-notes" value={notes} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />
          </div>
        </div>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
