# Fix for CSV Import 404 Error

## Issue Identified
CSV import is failing with:
```
GET http://localhost:3001/api/admin/csv-import/stream 404 (Not Found)
```

## Root Cause
The backend API server isn't running on `localhost:3001`, so the frontend can't reach the CSV import endpoint.

## Good News ✅
- Calendar data loaded successfully (9 calendars found)
- Frontend is working correctly
- CSV file selection works
- The backend endpoint code exists in `api-server.js`

## Solution: Start the Backend Server

### 1. **Check Backend Environment**
The backend needs a MongoDB connection. Verify your `.env` file in the `backend/` folder has:
```bash
MONGODB_CONNECTION_STRING=mongodb://localhost:27017/templeEvents
# or your Azure CosmosDB connection string
```

### 2. **Start the Backend Server**
```bash
cd backend
npm start
```

**Expected output:**
```
Server running on port 3001
Connected to MongoDB
```

### 3. **Alternative: Use Development Mode**
```bash
cd backend  
npm run dev  # Uses nodemon for auto-restart
```

### 4. **Verify Backend is Running**
Open a new terminal and test:
```bash
curl http://localhost:3001/api/health
# Should return server status
```

Or visit `http://localhost:3001` in your browser.

## Common Issues & Solutions

### **Issue**: MongoDB Connection Failed
```
Error connecting to MongoDB: MongooseError
```
**Solution**: 
- Install MongoDB locally, OR
- Use Azure CosmosDB connection string in `.env`

### **Issue**: Port Already in Use
```
Error: listen EADDRINUSE: address already in use :::3001
```
**Solution**:
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9
# Then restart backend
npm start
```

### **Issue**: Missing Environment Variables
```
Error: Missing required environment variables
```
**Solution**: Check `backend/.env` file has all required variables.

## Testing the Fix

### 1. **Start Backend First**
```bash
cd backend
npm start
```

### 2. **Then Test CSV Import**
- Navigate to Admin → CSV Import
- Select a calendar from dropdown
- Upload a CSV file
- Should see streaming progress instead of 404 error

## Expected Working Flow
1. ✅ Frontend loads (https://localhost:5173)
2. ✅ Backend runs (http://localhost:3001)  
3. ✅ Calendar dropdown populates
4. ✅ CSV file uploads with streaming progress
5. ✅ Real-time progress updates during import

## Development Setup Reminder

**Two Terminal Windows:**

**Terminal 1 - Frontend:**
```bash
npm run dev  # Runs on https://localhost:5173
```

**Terminal 2 - Backend:**
```bash
cd backend
npm run dev  # Runs on http://localhost:3001
```

## Verification Steps
1. **Check backend logs** for any startup errors
2. **Verify port 3001** is accessible
3. **Test CSV import** after backend is running
4. **Check browser console** for remaining errors

---

**Status**: ✅ **SOLUTION PROVIDED** - Start the backend server to resolve 404 errors.

**Root Issue**: Backend server not running on localhost:3001
**Next Step**: `cd backend && npm start` then test CSV import again.