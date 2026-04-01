/**
 * Verification script for Phase 1b migration
 * Run BEFORE and AFTER migration to compare results
 *
 * Usage:
 *   node __tests__/verify-room-reservations-migration.js
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('=== Phase 1b Migration Verification ===\n');

const backendDir = path.join(__dirname, '..');

// Check 1: Count roomReservationsCollection references
console.log('1. Checking roomReservationsCollection references in api-server.js...');
try {
  const result = execSync('grep -c "roomReservationsCollection" api-server.js', {
    cwd: backendDir,
    encoding: 'utf8'
  });
  console.log(`   Found: ${result.trim()} references`);
  console.log('   Status: MIGRATION NEEDED\n');
} catch (e) {
  if (e.status === 1) {
    console.log('   Found: 0 references');
    console.log('   Status: MIGRATION COMPLETE\n');
  } else {
    console.log('   Error running grep:', e.message);
  }
}

// Check 2: Verify unifiedEventsCollection is used for reservations
console.log('2. Checking unifiedEventsCollection usage...');
try {
  const result = execSync('grep -c "unifiedEventsCollection" api-server.js', {
    cwd: backendDir,
    encoding: 'utf8'
  });
  console.log(`   Found: ${result.trim()} references`);
  console.log('   Status: OK\n');
} catch (e) {
  if (e.status === 1) {
    console.log('   Found: 0 references');
    console.log('   Status: WARNING - No unifiedEventsCollection references found\n');
  } else {
    console.log('   Error running grep:', e.message);
  }
}

// Check 3: Verify no templeEvents__RoomReservations collection references
console.log('3. Checking for templeEvents__RoomReservations collection name...');
try {
  const result = execSync('grep -c "templeEvents__RoomReservations" api-server.js', {
    cwd: backendDir,
    encoding: 'utf8'
  });
  console.log(`   Found: ${result.trim()} references`);
  console.log('   Status: NEEDS CLEANUP\n');
} catch (e) {
  if (e.status === 1) {
    console.log('   Found: 0 references');
    console.log('   Status: OK\n');
  } else {
    console.log('   Error running grep:', e.message);
  }
}

// Check 4: List specific line numbers of roomReservationsCollection usage
console.log('4. Detailed roomReservationsCollection locations:');
try {
  const result = execSync('grep -n "roomReservationsCollection" api-server.js | head -20', {
    cwd: backendDir,
    encoding: 'utf8'
  });
  console.log(result);
} catch (e) {
  if (e.status === 1) {
    console.log('   None found - migration complete!\n');
  } else {
    console.log('   Error:', e.message);
  }
}

console.log('=== Verification Complete ===');
