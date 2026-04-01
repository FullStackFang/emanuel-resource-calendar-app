// Test script for streaming CSV import endpoint
const FormData = require('form-data');
const fs = require('fs');
const fetch = require('node-fetch');

async function testStreamingImport() {
  console.log('Testing streaming CSV import endpoint...');
  
  // Create test CSV content
  const testCsv = `rsId,Subject,StartDate,StartTime,StartDateTime,EndDate,EndTime,EndDateTime,AllDayEvent,Location,Description,Categories,Deleted,AttendeeEmails,AttendeeNames
-1999851752,Test Event 1,7/28/2025,18:00:00,2025-07-28T18:00:00,7/28/2025,19:30:00,2025-07-28T19:30:00,0,405,Test description,Test Category,0,test@example.com,Test User
-1999851753,Test Event 2,7/21/2025,18:00:00,2025-07-21T18:00:00,7/21/2025,19:30:00,2025-07-21T19:30:00,0,405,Test description 2,Test Category,0,test@example.com,Test User
-1999851754,Test Event 3,7/14/2025,18:00:00,2025-07-14T18:00:00,7/14/2025,19:30:00,2025-07-14T19:30:00,0,405,Test description 3,Test Category,0,test@example.com,Test User`;
  
  // Write test CSV to file
  const testFile = '/tmp/test-streaming.csv';
  fs.writeFileSync(testFile, testCsv);
  
  try {
    // Create form data
    const formData = new FormData();
    formData.append('csvFile', fs.createReadStream(testFile), {
      filename: 'test-streaming.csv',
      contentType: 'text/csv'
    });
    
    // Test the streaming endpoint
    const response = await fetch('http://localhost:3001/api/admin/csv-import/stream', {
      method: 'POST',
      body: formData,
      headers: {
        'Authorization': 'Bearer test-token', // You'll need a real token
        ...formData.getHeaders()
      }
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers.raw());
    
    if (response.ok) {
      console.log('✅ Streaming endpoint is accessible');
      
      // Read the streaming response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      console.log('📊 Streaming events:');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const eventData = JSON.parse(line.substring(6));
              console.log(`  ${eventData.type}: ${eventData.message}`);
            } catch (e) {
              console.log('  Raw line:', line);
            }
          }
        }
      }
    } else {
      console.log('❌ Streaming endpoint failed:', await response.text());
    }
    
  } catch (error) {
    console.error('❌ Error testing streaming endpoint:', error);
  } finally {
    // Clean up test file
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
    }
  }
}

// Run the test
testStreamingImport().catch(console.error);