# Database Schema Documentation

## Database: MongoDB

## Collections Overview

### 1. Users Collection
**Collection Name:** `users`

```javascript
{
  _id: ObjectId,
  outlook_user_id: String,           // Unique Outlook user identifier
  email: String,                     // User's email address
  display_name: String,              // User's display name
  role: String,                      // "admin" | "user"
  access_token: String,              // Encrypted OAuth access token
  refresh_token: String,             // Encrypted OAuth refresh token
  token_expires_at: Date,            // Token expiration timestamp
  google_connected: Boolean,         // Whether Google Calendar is connected
  google_access_token: String,       // Encrypted Google access token (optional)
  google_refresh_token: String,      // Encrypted Google refresh token (optional)
  created_at: Date,
  updated_at: Date,
  last_login: Date
}
```

**Indexes:**
- `outlook_user_id` (unique)
- `email` (unique)
- `role`

---

### 2. Calendars Collection
**Collection Name:** `calendars`

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,                 // Reference to Users collection
  outlook_calendar_id: String,       // Outlook calendar ID
  name: String,                      // Calendar display name
  color: String,                     // Calendar color (hex)
  is_primary: Boolean,               // Is this the primary calendar
  can_edit: Boolean,                 // Edit permissions
  is_active: Boolean,                // Whether to sync this calendar
  google_calendar_id: String,        // Google Calendar ID (if synced)
  sync_enabled: Boolean,             // Cross-platform sync enabled
  last_synced: Date,                 // Last sync timestamp
  created_at: Date,
  updated_at: Date
}
```

**Indexes:**
- `user_id`
- `outlook_calendar_id` (unique)
- `user_id + is_active`

---

### 3. Events Collection
**Collection Name:** `events`

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,                 // Reference to Users collection
  calendar_id: ObjectId,             // Reference to Calendars collection
  
  // Original Outlook Data
  outlook_event_id: String,          // Original Outlook event ID
  outlook_etag: String,              // Outlook ETag for conflict detection
  
  // Basic Event Data
  title: String,
  description: String,
  start_time: Date,
  end_time: Date,
  all_day: Boolean,
  location: String,
  category: String,                  // Original Outlook category
  
  // Custom Internal Fields
  setup_start_time: Date,            // Custom: When setup begins
  setup_end_time: Date,              // Custom: When setup ends
  teardown_start_time: Date,         // Custom: When teardown begins
  teardown_end_time: Date,           // Custom: When teardown ends
  internal_notes: String,            // Internal-only notes
  equipment_required: [String],      // Array of required equipment
  staff_assigned: [String],          // Array of assigned staff
  budget_allocated: Number,          // Budget for this event
  client_contact: String,            // Client contact information
  internal_category: String,         // Internal categorization
  priority_level: String,            // "low" | "medium" | "high" | "critical"
  
  // Attendees
  attendees: [
    {
      email: String,
      name: String,
      response_status: String,       // "none" | "accepted" | "declined" | "tentative"
      is_organizer: Boolean
    }
  ],
  
  // Recurrence
  is_recurring: Boolean,
  recurrence_pattern: {
    type: String,                    // "daily" | "weekly" | "monthly" | "yearly"
    interval: Number,                // Every X days/weeks/months
    days_of_week: [String],          // For weekly: ["monday", "wednesday"]
    day_of_month: Number,            // For monthly: 15th of month
    end_date: Date,                  // When recurrence ends
    occurrence_count: Number         // Or end after X occurrences
  },
  recurrence_master_id: ObjectId,    // Reference to master event if this is an instance
  
  // Sync Status
  google_event_id: String,           // Google Calendar event ID (if synced)
  sync_status: String,               // "synced" | "pending" | "error" | "not_synced"
  last_synced: Date,
  sync_errors: [String],             // Array of sync error messages
  
  // Metadata
  created_at: Date,
  updated_at: Date,
  created_by: ObjectId,              // User who created the event
  last_modified_by: ObjectId         // User who last modified the event
}
```

**Indexes:**
- `user_id`
- `calendar_id`
- `outlook_event_id` (unique, sparse)
- `user_id + start_time`
- `category`
- `internal_category`
- `location`
- `sync_status`
- `recurrence_master_id`

---

### 4. Categories Collection
**Collection Name:** `categories`

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,                 // Reference to Users collection (null for global)
  name: String,                      // Category name
  color: String,                     // Display color (hex)
  type: String,                      // "internal" | "external" | "system"
  description: String,               // Category description
  is_active: Boolean,                // Whether category is active
  usage_count: Number,               // How many events use this category
  created_at: Date,
  updated_at: Date
}
```

**Indexes:**
- `user_id`
- `name + user_id` (unique)
- `type`

---

### 5. Locations Collection
**Collection Name:** `locations`

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,                 // Reference to Users collection (null for global)
  name: String,                      // Location name
  address: String,                   // Full address
  coordinates: {
    latitude: Number,
    longitude: Number
  },
  capacity: Number,                  // Maximum capacity
  equipment_available: [String],     // Available equipment
  setup_time_required: Number,       // Minutes needed for setup
  notes: String,                     // Additional notes about location
  usage_count: Number,               // How many events use this location
  is_active: Boolean,
  created_at: Date,
  updated_at: Date
}
```

**Indexes:**
- `user_id`
- `name + user_id` (unique)
- `coordinates` (2dsphere for geo queries)

---

### 6. Sync Logs Collection
**Collection Name:** `sync_logs`

```javascript
{
  _id: ObjectId,
  user_id: ObjectId,                 // Reference to Users collection
  sync_type: String,                 // "outlook_to_local" | "local_to_outlook" | "google_sync"
  status: String,                    // "success" | "error" | "partial"
  events_processed: Number,          // Number of events processed
  events_created: Number,            // Number of events created
  events_updated: Number,            // Number of events updated
  events_deleted: Number,            // Number of events deleted
  errors: [
    {
      event_id: String,              // Outlook or Google event ID
      error_message: String,
      error_code: String
    }
  ],
  started_at: Date,
  completed_at: Date,
  duration_ms: Number                // Sync duration in milliseconds
}
```

**Indexes:**
- `user_id`
- `sync_type`
- `status`
- `started_at`

---

### 7. Admin Exports Collection
**Collection Name:** `admin_exports`

```javascript
{
  _id: ObjectId,
  admin_user_id: ObjectId,           // Admin who initiated export
  export_type: String,               // "events" | "users" | "full_backup"
  filters: {
    start_date: Date,
    end_date: Date,
    user_ids: [ObjectId],
    categories: [String],
    locations: [String]
  },
  file_path: String,                 // Path to generated export file
  file_size: Number,                 // File size in bytes
  record_count: Number,              // Number of records exported
  status: String,                    // "pending" | "completed" | "error"
  error_message: String,             // Error details if failed
  created_at: Date,
  completed_at: Date
}
```

**Indexes:**
- `admin_user_id`
- `export_type`
- `status`
- `created_at`

---

## Relationships

### User → Calendars (One-to-Many)
- One user can have multiple calendars
- Each calendar belongs to one user

### User → Events (One-to-Many)
- One user can have multiple events
- Each event belongs to one user

### Calendar → Events (One-to-Many)
- One calendar can contain multiple events
- Each event belongs to one calendar

### Events → Events (Self-referencing for Recurrence)
- Recurring events reference a master event
- Master event can have multiple instances

## Data Integrity Rules

1. **Outlook Event Mapping:** Each event must maintain its `outlook_event_id` to prevent duplicates
2. **User Deletion:** When deleting a user, cascade delete all their calendars, events, and personal categories
3. **Calendar Deletion:** When deleting a calendar, cascade delete all its events
4. **Token Security:** All OAuth tokens must be encrypted before storage
5. **Audit Trail:** Track creation and modification timestamps on all collections

## Performance Considerations

1. **Indexes:** Ensure proper indexing for common queries (user_id, date ranges, categories)
2. **Pagination:** Implement pagination for event queries to handle large datasets
3. **Archival:** Consider archiving old events (>2 years) to a separate collection
4. **Caching:** Cache frequently accessed categories and locations

## Migration Notes

- Include migration scripts for schema changes
- Backup strategy for production data
- Test data seeding for development environments
