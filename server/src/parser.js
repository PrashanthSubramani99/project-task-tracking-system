/**
 * Extract action items out of raw discussion notes.
 *
 * Handles the shapes a small team actually produces: bullet lists typed during
 * a Google Meet, a pasted WhatsApp export, or plain sentences from a phone
 * call. Everything it returns is a *suggestion* — the UI shows them as
 * editable rows before anything is saved, so a false positive costs a click.
 */

const WHATSAPP_PREFIXES = [
  // [12/03/2024, 10:15:23] Ramesh: text
  /^\[?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?\s*\]?\s*[-–]?\s*([^:]{1,40}):\s*(.*)$/,
  // 10:15 - Ramesh: text
  /^\d{1,2}:\d{2}\s*(?:[AaPp][Mm])?\s*[-–]\s*([^:]{1,40}):\s*(.*)$/,
];

const BULLET = /^\s*(?:[-*•·>+]|\d+[.)]|\[\s*[xX ]?\s*\])\s+/;

const ACTION_MARKERS = [
  /^\s*(?:AI|A\.I\.|ACTION|ACTION ITEM|TODO|TO DO|TASK|FOLLOW ?UP)\s*[:\-–]\s*/i,
];

/** Verbs that make a sentence an assignment rather than a remark. */
const ACTION_PHRASES = [
  /\bwill\s+(?:be\s+)?\w+/i,
  /\bto\s+(?:check|do|send|share|create|fix|update|prepare|review|deploy|setup|set up|configure|confirm|verify|raise|close|test|document|call|discuss|arrange|schedule|finalise|finalize|migrate|install)\b/i,
  /\b(?:needs? to|has to|have to|should|must|shall)\b/i,
  /\b(?:please|kindly)\s+\w+/i,
  /\b(?:take care of|follow up|followup|handle|own(?:s|ing)?)\b/i,
  /\b(?:assigned to|owner)\b/i,
  /\b(?:i(?:'| a)?m going to|i will|we will|let(?:'|)s)\b/i,
];

const NOISE = [
  /^\s*(?:ok(?:ay)?|thanks?|thank you|noted|sure|yes|no|hi|hello|good (?:morning|evening|afternoon)|welcome|bye|👍+|done)\W*$/i,
  /^\s*<media omitted>\s*$/i,
  /^\s*(?:messages? and calls are end-to-end encrypted|this message was deleted)/i,
  /^\s*(?:agenda|notes?|minutes|attendees?|participants?|present|discussion|decisions?|summary)\s*[:\-–]?\s*$/i,
];

const PRIORITY_HINTS = [
  { re: /\b(?:urgent|asap|immediately|critical|blocker|p0|show ?stopper)\b/i, priority: 'urgent' },
  { re: /\b(?:high priority|important|priority|p1|escalat)/i, priority: 'high' },
  { re: /\b(?:low priority|nice to have|whenever|p3|later)\b/i, priority: 'low' },
];

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const iso = (d) => d.toISOString().slice(0, 10);

function addDays(base, n) {
  const d = new Date(base.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Pull a due date out of a phrase, resolved against the meeting date.
 * Returns { date, matched } or null.
 */
export function extractDueDate(text, baseDate = new Date()) {
  const base = new Date(baseDate);
  if (Number.isNaN(base.getTime())) return null;
  const lower = text.toLowerCase();

  // Explicit ISO date: 2024-03-15
  let m = lower.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return { date: m[0], matched: m[0] };

  // 15/03 or 15/03/2024 or 15-03-24  (day-first, the common convention here)
  m = lower.match(/\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/);
  if (m && !/\d{1,2}:\d{2}/.test(m[0])) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = m[3] ? Number(m[3]) : base.getFullYear();
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const d = new Date(Date.UTC(year, month - 1, day));
      if (!m[3] && d < base) d.setUTCFullYear(year + 1);
      return { date: iso(d), matched: m[0] };
    }
  }

  // 15 Mar / March 15
  m = lower.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join('|')})[a-z]*\\b`));
  if (!m) {
    const m2 = lower.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
    if (m2) m = [m2[0], m2[2], m2[1]];
  }
  if (m) {
    const day = Number(m[1]);
    const month = MONTHS.indexOf(m[2].slice(0, 3));
    if (day >= 1 && day <= 31 && month >= 0) {
      const d = new Date(Date.UTC(base.getFullYear(), month, day));
      if (d < base) d.setUTCFullYear(base.getFullYear() + 1);
      return { date: iso(d), matched: m[0] };
    }
  }

  if (/\b(?:today|eod|end of day|by tonight)\b/.test(lower)) return { date: iso(base), matched: 'today' };
  if (/\btomorrow\b/.test(lower)) return { date: iso(addDays(base, 1)), matched: 'tomorrow' };
  if (/\bday after tomorrow\b/.test(lower)) return { date: iso(addDays(base, 2)), matched: 'day after tomorrow' };
  if (/\b(?:next week)\b/.test(lower)) return { date: iso(addDays(base, 7)), matched: 'next week' };
  if (/\b(?:this week|eow|end of (?:the )?week)\b/.test(lower)) {
    const daysToFriday = (5 - base.getDay() + 7) % 7 || 7;
    return { date: iso(addDays(base, daysToFriday)), matched: 'end of week' };
  }
  if (/\bnext month\b/.test(lower)) return { date: iso(addDays(base, 30)), matched: 'next month' };

  // by Friday / on Monday
  const wd = lower.match(new RegExp(`\\b(?:by|on|before|until|till)?\\s*(${WEEKDAYS.join('|')})\\b`));
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    const delta = (target - base.getDay() + 7) % 7 || 7;
    return { date: iso(addDays(base, delta)), matched: wd[1] };
  }

  // in 3 days / in 2 weeks
  const rel = lower.match(/\bin\s+(\d{1,2})\s+(day|week|month)s?\b/);
  if (rel) {
    const n = Number(rel[1]);
    const mult = rel[2] === 'week' ? 7 : rel[2] === 'month' ? 30 : 1;
    return { date: iso(addDays(base, n * mult)), matched: rel[0] };
  }

  return null;
}

/** Look for an owner in the sentence and match it against known people. */
function extractOwner(text, people) {
  if (!people?.length) return null;

  const at = text.match(/@([a-zA-Z0-9._-]{2,40})/);
  if (at) {
    const handle = at[1].toLowerCase();
    const hit = people.find(
      (p) =>
        (p.email || '').split('@')[0].toLowerCase() === handle ||
        p.name.toLowerCase().replace(/\s+/g, '') === handle.replace(/[._-]/g, '') ||
        p.name.split(' ')[0].toLowerCase() === handle,
    );
    if (hit) return { user: hit, confidence: 0.95, matched: at[0] };
  }

  // A name mentioned anywhere in the sentence, longest first so
  // "Ramesh Kumar" wins over "Ramesh".
  const candidates = [];
  for (const p of people) {
    for (const token of [p.name, p.name.split(' ')[0]]) {
      if (!token || token.length < 3) continue;
      const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const hit = text.match(re);
      if (hit) candidates.push({ user: p, matched: hit[0], index: hit.index ?? 999, length: token.length });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.length - a.length || a.index - b.index);
  const best = candidates[0];
  // A name at the start of the line ("Ramesh to check the ports") is a
  // stronger signal than one buried mid-sentence.
  return { user: best.user, confidence: best.index <= 2 ? 0.85 : 0.6, matched: best.matched };
}

function detectPriority(text) {
  for (const hint of PRIORITY_HINTS) if (hint.re.test(text)) return hint.priority;
  return 'medium';
}

/** Strip list markers, action prefixes and trailing punctuation. */
function cleanText(line) {
  let out = line.replace(BULLET, '');
  for (const marker of ACTION_MARKERS) out = out.replace(marker, '');
  out = out.replace(/^\s*[-–—]\s*/, '').replace(/\s+/g, ' ').trim();
  out = out.replace(/[.,;]+$/, '');
  return out;
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Main entry point.
 *
 * @param {string} raw            pasted notes
 * @param {object} opts
 * @param {Array}  opts.people    [{ id, name, email }] used for owner matching
 * @param {string} opts.baseDate  meeting date, anchors relative dates
 * @returns {{items: Array, stats: object}}
 */
export function parseActionItems(raw, { people = [], baseDate = new Date() } = {}) {
  const lines = String(raw || '').split(/\r?\n/);
  const items = [];
  let scanned = 0;
  let inActionBlock = false;

  for (const original of lines) {
    let line = original.trim();
    if (!line) {
      inActionBlock = false;
      continue;
    }

    // A heading like "Action items:" turns the following bullets into actions
    // even when they carry no verb of their own.
    if (/^\s*(?:action items?|actions?|todos?|to ?do|next steps?|follow ?ups?|tasks?)\s*[:\-–]?\s*$/i.test(line)) {
      inActionBlock = true;
      continue;
    }
    if (/^\s*(?:decisions?|notes?|discussion|agenda|summary|blockers?|risks?|parking lot)\s*[:\-–]?\s*$/i.test(line)) {
      inActionBlock = false;
      continue;
    }

    let speaker = null;
    for (const re of WHATSAPP_PREFIXES) {
      const m = line.match(re);
      if (m) {
        speaker = m[1].trim();
        line = m[2].trim();
        break;
      }
    }
    if (!line) continue;

    scanned += 1;
    if (NOISE.some((re) => re.test(line))) continue;

    const isBullet = BULLET.test(line);
    const hasMarker = ACTION_MARKERS.some((re) => re.test(line));
    const hasPhrase = ACTION_PHRASES.some((re) => re.test(line));
    const checked = /^\s*\[\s*[xX]\s*\]/.test(line);

    // In a chat log, someone volunteering ("I will send it tomorrow") is the
    // commitment — there is no bullet list to lean on.
    const commitment = /\b(?:i(?:'ll| will| am going to| can)|let me|will do|on it|i'?ll take)\b/i.test(line);

    let confidence = 0;
    if (hasMarker) confidence += 0.6;
    if (inActionBlock && isBullet) confidence += 0.5;
    if (hasPhrase) confidence += 0.35;
    if (isBullet) confidence += 0.1;
    if (speaker && commitment) confidence += 0.35;
    if (speaker && /\b(?:please|kindly)\b/i.test(line)) confidence += 0.2;
    if (line.endsWith('?')) confidence -= 0.35;
    if (line.split(/\s+/).length < 3) confidence -= 0.4;

    if (confidence < 0.4) continue;

    const text = cleanText(line);
    if (text.length < 4) continue;

    const owner = extractOwner(text, people);
    // Fall back to the WhatsApp speaker when they volunteered ("I will do X").
    let ownerUser = owner?.user ?? null;
    let ownerConfidence = owner?.confidence ?? 0;
    if (!ownerUser && speaker && /\b(?:i will|i'll|im going to|i am going to|i can|let me)\b/i.test(text)) {
      const hit = people.find(
        (p) => p.name.toLowerCase() === speaker.toLowerCase() || p.name.split(' ')[0].toLowerCase() === speaker.toLowerCase(),
      );
      if (hit) {
        ownerUser = hit;
        ownerConfidence = 0.8;
      }
    }

    const due = extractDueDate(text, baseDate);

    items.push({
      text: titleCase(text),
      owner_id: ownerUser?.id ?? null,
      owner_name: ownerUser?.name ?? null,
      owner_confidence: Number(ownerConfidence.toFixed(2)),
      due_date: due?.date ?? null,
      due_matched: due?.matched ?? null,
      priority: detectPriority(text),
      confidence: Number(Math.min(confidence, 1).toFixed(2)),
      already_done: checked,
      source_line: original.trim(),
      speaker,
    });
  }

  // De-duplicate near-identical lines (people repeat themselves in chat).
  const seen = new Set();
  const unique = items.filter((item) => {
    const fingerprint = item.text.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);
    if (seen.has(fingerprint)) return false;
    seen.add(fingerprint);
    return true;
  });

  return {
    items: unique,
    stats: {
      lines_scanned: scanned,
      candidates: unique.length,
      with_owner: unique.filter((i) => i.owner_id).length,
      with_due_date: unique.filter((i) => i.due_date).length,
    },
  };
}
