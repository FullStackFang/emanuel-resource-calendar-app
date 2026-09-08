const { MongoClient } = require('../../backend/node_modules/mongodb');
const templates = require('../../backend/services/emailTemplates');
async function main() {
  if (process.env.EMAIL_PROD_DOTENV) {
    const config = require('../../backend/node_modules/dotenv').parse(process.env.EMAIL_PROD_DOTENV);
    process.env.MONGODB_CONNECTION_STRING = config.MONGODB_CONNECTION_STRING;
    process.env.MONGODB_DATABASE_NAME = config.MONGODB_DATABASE_NAME || 'emanuelnyc';
  }
  if (!process.env.MONGODB_CONNECTION_STRING) throw new Error('Production database connection missing');
  const client = new MongoClient(process.env.MONGODB_CONNECTION_STRING, { serverSelectionTimeoutMS: 20000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DATABASE_NAME || 'emanuelnyc');
    const collection = db.collection('templeEvents__SystemSettings');
    const id = 'email-template-assignment-schedule';
    const override = await collection.findOne({ _id: id });
    templates.setDbConnection(db);
    let template = await templates.getTemplate('assignment-schedule');
    const phrases = ['Your schedule is below for {{scopeLabel}}.', 'This is the first time we are rolling out this automated system.', "Please call John O'Hara at ext. 338 if you have any questions."];
    console.log(JSON.stringify({ customized: !!override, wordingPresent: phrases.every(p => template.body.includes(p)), schedulePlaceholder: template.body.includes('{{assignmentsTable}}') }));
    if (!template.body.includes('{{assignmentsTable}}')) throw new Error('Schedule placeholder missing; needs review');
    if (!phrases.every(p => template.body.includes(p))) {
      if (!process.argv.includes('--apply')) throw new Error('Saved customization needs rollout wording');
      const missing = phrases.filter(p => !template.body.includes(p));
      const addition = missing.map(p => `<p style="margin: 0 0 18px 0; color: #4a5568; font-size: 15px; line-height: 1.6;">${p}</p>`).join('\n');
      const body = template.body.replace('{{assignmentsTable}}', addition + '\n\n{{assignmentsTable}}');
      const result = await collection.updateOne({ _id: id, body: override.body }, { $set: { body, updatedAt: new Date(), updatedBy: 'deployment:email-rollout' } });
      if (result.modifiedCount !== 1) throw new Error('Template changed concurrently');
      console.log('Updated only missing introduction text in saved template.');
    }
    const result = await templates.generateFromTemplate('assignment-schedule', { scopeLabel: '2026 High Holy Days', recipientName: 'Sample recipient', assignmentSummary: '2 assignments', assignmentsTable: '<div>Sample personal schedule</div>', eventUrl: '' });
    if (!result.html.includes('Your schedule is below for 2026 High Holy Days.') || !result.html.includes("Please call John O'Hara at ext. 338 if you have any questions.") || !result.html.includes('Sample personal schedule')) throw new Error('Effective production template rendering failed');
    console.log('PASS: effective production template renders rollout wording, schedule name, and personal schedule. No email sent.');
  } finally { await client.close(); }
}
main().catch(e => { console.error(e.name + ': ' + (e.message.includes('connection') ? 'Database connection failed' : e.message)); process.exitCode = 1; });
