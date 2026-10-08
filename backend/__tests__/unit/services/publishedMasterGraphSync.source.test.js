/**
 * Source assertion (N1, edit-request-approval-graph-sync).
 *
 * The approval path lost its Graph sync because Save and approval each owned a
 * private copy of the logic and only one survived a refactor. Both handlers
 * must now call the shared module, and the Save handler must not grow its own
 * PATCH payload builder back. Behaviour is covered by the characterization and
 * ERG suites; this pins the STRUCTURE that keeps them from drifting.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '../../../api-server.js'), 'utf8');

function occurrences(needle) {
  return source.split(needle).length - 1;
}

describe('publishedMasterGraphSync is shared by Save and approval (SRC-1..3)', () => {
  it('SRC-1: reconcilePublishedSeries is called from both handlers', () => {
    expect(occurrences('reconcilePublishedSeries(')).toBeGreaterThanOrEqual(2);
  });

  it('SRC-2: buildMasterPatch is called from both handlers', () => {
    expect(occurrences('buildMasterPatch(')).toBeGreaterThanOrEqual(2);
  });

  // The spec named `graphUpdate.recurrence = buildGraphRecurrence(`, which never
  // existed verbatim (Save assigns through a `recurrenceUpdate` local), so that
  // needle passes vacuously. These are the expressions Save actually used; the
  // create paths (publish, restore, draft submit) legitimately keep theirs.
  it('SRC-3: api-server builds no master PATCH recurrence payload inline', () => {
    expect(occurrences('buildGraphRecurrence(updates.recurrence')).toBe(0);
    expect(occurrences('graphUpdate.recurrence =')).toBe(0);
  });
});
