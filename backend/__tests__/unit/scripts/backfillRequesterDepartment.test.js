const { buildBackfillQuery } = require('../../../migrate-backfill-requester-department');

describe('backfill requester department — target query', () => {
  it('targets app events with an owner email but no department, excludes rsched + children', () => {
    const q = buildBackfillQuery();
    expect(q.source).toEqual({ $ne: 'rsSched' });
    expect(q.eventType).toEqual({ $in: ['singleInstance', 'seriesMaster'] });
    expect(q['roomReservationData.requestedBy.email']).toEqual({ $exists: true, $nin: [null, ''] });
    expect(q.$or).toEqual([
      { 'roomReservationData.requestedBy.department': { $exists: false } },
      { 'roomReservationData.requestedBy.department': '' },
      { 'roomReservationData.requestedBy.department': null },
    ]);
  });
});
