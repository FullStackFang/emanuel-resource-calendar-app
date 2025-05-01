// models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true,
    unique: true  // This will be the Microsoft ID from MSAL
  },
  email: {
    type: String,
    required: true,
    unique: true
  },
  displayName: {
    type: String,
    required: true
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date
  },
  preferences: {
    defaultView: {
      type: String,
      enum: ['day', 'week', 'month'],
      default: 'week'
    },
    defaultGroupBy: {
      type: String,
      enum: ['categories', 'locations'],
      default: 'categories'
    },
    preferredZoomLevel: {
      type: Number,
      min: 50,
      max: 150,
      default: 100
    }
  }
}, {
  timestamps: true,
  collection: 'templeEvents__Users' // Use your specified collection name
});

module.exports = mongoose.model('User', UserSchema);