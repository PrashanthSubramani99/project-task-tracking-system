import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActionItems, extractDueDate } from '../src/parser.js';

const PEOPLE = [
  { id: 1, name: 'Prashanth S', email: 'prashanth@example.com' },
  { id: 2, name: 'Anita Rao', email: 'anita@example.com' },
  { id: 3, name: 'Vikram Iyer', email: 'vikram@example.com' },
  { id: 4, name: 'Sneha Menon', email: 'sneha@example.com' },
];

// A fixed Monday so weekday and relative-date maths is deterministic.
const BASE = new Date('2026-03-02T10:00:00Z');

const parse = (notes) => parseActionItems(notes, { people: PEOPLE, baseDate: BASE });
const texts = (result) => result.items.map((item) => item.text);

test('pulls bullets out of an "Action items" block', () => {
  const result = parse(`Sprint planning

Discussion:
- Login is slow on staging
- Customers want a status filter

Action items:
- Vikram to profile the login endpoint
- Sneha will build the filter UI`);

  assert.equal(result.items.length, 2);
  assert.match(texts(result)[0], /profile the login endpoint/);
  assert.equal(result.items[0].owner_id, 3);
  assert.equal(result.items[1].owner_id, 4);
});

test('leaves discussion bullets alone when they carry no commitment', () => {
  const result = parse(`Discussion:
- Login is slow on staging
- Customers want a status filter
- The build broke twice yesterday`);

  assert.equal(result.items.length, 0);
});

test('reads a WhatsApp export and attributes first-person commitments to the speaker', () => {
  const result = parse(`[02/03/2026, 21:14] Anita: quick one about the demo
[02/03/2026, 21:15] Anita: thanks
[02/03/2026, 21:16] Vikram: I will finish the CSV export tomorrow
[02/03/2026, 21:17] Anita: ok
[02/03/2026, 21:18] Anita: Sneha please add the download button`);

  assert.equal(result.items.length, 2);

  const commitment = result.items.find((item) => /CSV export/.test(item.text));
  assert.equal(commitment.owner_id, 3, 'the speaker owns what they volunteered for');
  assert.equal(commitment.due_date, '2026-03-03');

  const request = result.items.find((item) => /download button/.test(item.text));
  assert.equal(request.owner_id, 4);
});

test('ignores chat noise', () => {
  const result = parse(`[02/03/2026, 21:14] Anita: ok
[02/03/2026, 21:15] Vikram: 👍
[02/03/2026, 21:16] Sneha: thanks
[02/03/2026, 21:17] Anita: <Media omitted>
[02/03/2026, 21:18] Anita: sure`);

  assert.equal(result.items.length, 0);
});

test('picks up an obligation with no bullet and no heading', () => {
  const result = parse('Someone needs to document the UAT ports before the release');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].owner_id, null);
});

test('does not treat a question as an action', () => {
  const result = parse('Should we move the demo to Thursday?');
  assert.equal(result.items.length, 0);
});

test('detects urgency from the wording', () => {
  const result = parse(`Action items:
- Rahul to run the regression suite, urgent
- Anita to tidy the backlog whenever there is time`);

  assert.equal(result.items[0].priority, 'urgent');
  assert.equal(result.items[1].priority, 'low');
});

test('resolves @handles to people', () => {
  const result = parse('Action items:\n- @vikram to rotate the staging credentials');
  assert.equal(result.items[0].owner_id, 3);
  assert.equal(result.items[0].owner_confidence, 0.95);
});

test('de-duplicates the same commitment repeated in a thread', () => {
  const result = parse(`[02/03/2026, 21:14] Vikram: I will fix the export bug
[02/03/2026, 21:20] Vikram: I will fix the export bug`);
  assert.equal(result.items.length, 1);
});

test('stops treating bullets as actions once a new heading starts', () => {
  const result = parse(`Action items:
- Vikram to check the logs

Decisions:
- We keep the current release date
- The redesign moves to next sprint`);

  assert.equal(result.items.length, 1);
  assert.match(result.items[0].text, /check the logs/);
});

test('reports useful stats', () => {
  const result = parse(`Action items:
- Vikram to check the logs by Friday
- Someone to update the wiki`);

  assert.equal(result.stats.candidates, 2);
  assert.equal(result.stats.with_owner, 1);
  assert.equal(result.stats.with_due_date, 1);
});

// --------------------------------------------------------------- due dates --

test('reads weekday names forward from the meeting date', () => {
  // BASE is a Monday.
  assert.equal(extractDueDate('by Friday', BASE).date, '2026-03-06');
  assert.equal(extractDueDate('on Monday', BASE).date, '2026-03-09', 'the next Monday, not today');
});

test('reads relative phrases', () => {
  assert.equal(extractDueDate('do it today', BASE).date, '2026-03-02');
  assert.equal(extractDueDate('by tomorrow', BASE).date, '2026-03-03');
  assert.equal(extractDueDate('next week', BASE).date, '2026-03-09');
  assert.equal(extractDueDate('in 3 days', BASE).date, '2026-03-05');
  assert.equal(extractDueDate('end of week', BASE).date, '2026-03-06');
});

test('reads day-first numeric dates', () => {
  assert.equal(extractDueDate('before 15/04', BASE).date, '2026-04-15');
  assert.equal(extractDueDate('by 15/04/2027', BASE).date, '2027-04-15');
});

test('rolls a past bare date into next year', () => {
  assert.equal(extractDueDate('by 15/01', BASE).date, '2027-01-15');
});

test('reads written month names', () => {
  assert.equal(extractDueDate('by 15 Apr', BASE).date, '2026-04-15');
  assert.equal(extractDueDate('by April 15', BASE).date, '2026-04-15');
});

test('reads ISO dates as written', () => {
  assert.equal(extractDueDate('deadline 2026-12-01', BASE).date, '2026-12-01');
});

test('returns nothing when there is no date', () => {
  assert.equal(extractDueDate('fix the login bug', BASE), null);
});

test('does not read a clock time as a date', () => {
  assert.equal(extractDueDate('call at 10:30', BASE), null);
});
