const { MongoClient } = require('../backend/node_modules/mongodb');
require('../backend/node_modules/dotenv').config({ path: require('path').join(__dirname, '../backend/.env') });

async function main() {
  const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE_NAME || 'emanuelnyc');
    const events = await db.collection('templeEvents__Events').find({ $or: [
      { eventId: 'evt-request-1787067397075-uoi48kedt' },
      { 'calendarData.eventTitle': /Dash Greenberg Rehearsal/i },
      { eventTitle: /Dash Greenberg Rehearsal/i }
    ] }).limit(30).toArray();
    console.log(JSON.stringify({ database: db.databaseName, events: events.map(e => ({
      _id: e._id, eventId: e.eventId, status: e.status, isDeleted: e.isDeleted,
      title: e.calendarData?.eventTitle || e.eventTitle, calendarOwner: e.calendarOwner,
      calendarData: e.calendarData, startDateTime: e.startDateTime, start: e.start,
      graph: { id: e.graphData?.id, start: e.graphData?.start, end: e.graphData?.end, lastModifiedDateTime: e.graphData?.lastModifiedDateTime },
      _version: e._version, lastModifiedDateTime: e.lastModifiedDateTime, lastModifiedBy: e.lastModifiedBy,
      statusHistory: e.statusHistory, communicationHistory: e.roomReservationData?.communicationHistory,
      pendingEditRequest: e.pendingEditRequest, syncStatus: e.syncStatus
    })) }, null, 2));
    const target = events.find(e => e.eventId === 'evt-request-1787067397075-uoi48kedt');
    if (!target) return;
    if (process.argv.includes('--graph')) {
      const graph = require('../backend/services/graphApiService');
      const live = await graph.getEvent(target.calendarOwner, target.calendarId, target.graphData.id, {
        select: 'id,subject,start,end,lastModifiedDateTime,changeKey'
      });
      console.log(JSON.stringify({ liveGraph: live }, null, 2));
    }
    const ids = [target._id, String(target._id), target.eventId, target.graphData?.id].filter(Boolean);
    for (const name of ['templeEvents__EventAuditHistory', 'templeEvents__ReservationAuditHistory', 'templeEvents__EditRequests']) {
      const docs = await db.collection(name).find({ $or: [
        { eventId: { $in: ids } }, { reservationId: { $in: ids } }, { 'eventSnapshot.eventId': target.eventId }
      ] }).limit(200).toArray();
      console.log(JSON.stringify({ collection: name, records: docs.sort((a, b) => new Date(a.timestamp || a.createdAt) - new Date(b.timestamp || b.createdAt)) }, null, 2));
    }
  } finally { await client.close(); }
}
main().catch(err => { console.error(err.name + ': ' + err.message.replace(/mongodb[^\s]+/g, '[connection redacted]')); process.exitCode = 1; });
