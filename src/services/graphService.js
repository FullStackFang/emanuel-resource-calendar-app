// src/services/graphService.js
import { Client } from "@microsoft/microsoft-graph-client";
import { graphConfig } from "../config/authConfig";

// Helper function to get Microsoft Graph client
export const getGraphClient = (accessToken) => {
  // Initialize Graph client
  const graphClient = Client.init({
    // Use the provided access token to authenticate requests
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
  
  return graphClient;
};

// Get user information
export const getUserDetails = async (accessToken) => {
  try {
    const graphClient = getGraphClient(accessToken);
    const user = await graphClient.api(graphConfig.graphMeEndpoint).get();
    return user;
  } catch (error) {
    console.error("Error getting user details:", error);
    throw error;
  }
};

// Get calendar events
export const getCalendarEvents = async (accessToken, startDateTime, endDateTime) => {
  try {
    const graphClient = getGraphClient(accessToken);
    
    // Format the query with start and end times
    const eventsQuery = `${graphConfig.graphEventsEndpoint}?$select=subject,organizer,start,end,location&$orderby=start/dateTime&$filter=start/dateTime ge '${startDateTime}' and end/dateTime le '${endDateTime}'`;
    
    const events = await graphClient.api(eventsQuery).get();
    return events;
  } catch (error) {
    console.error("Error getting calendar events:", error);
    throw error;
  }
};

// Get all calendars (owned and shared)
export const getCalendars = async (accessToken) => {
  try {
    const graphClient = getGraphClient(accessToken);
    const calendars = await graphClient
      .api('/me/calendars')
      .select('id,name,owner,canEdit,canShare,canViewPrivateItems,isDefaultCalendar,isShared,isRemovable')
      .orderby('name')
      .get();
    return calendars;
  } catch (error) {
    console.error("Error getting calendars:", error);
    throw error;
  }
};

// Get shared calendars specifically
export const getSharedCalendars = async (accessToken) => {
  try {
    const graphClient = getGraphClient(accessToken);
    const calendars = await graphClient
      .api('/me/calendars')
      .select('id,name,owner,canEdit,canShare,canViewPrivateItems,isDefaultCalendar,isShared,isRemovable')
      .filter('isShared eq true')
      .orderby('name')
      .get();
    return calendars;
  } catch (error) {
    console.error("Error getting shared calendars:", error);
    throw error;
  }
};

// Create a new calendar event
export const createCalendarEvent = async (accessToken, event) => {
  try {
    const graphClient = getGraphClient(accessToken);
    const result = await graphClient.api(graphConfig.graphEventsEndpoint).post(event);
    return result;
  } catch (error) {
    console.error("Error creating calendar event:", error);
    throw error;
  }
};

// Extended Properties for Event Linking
const EXTENDED_PROPERTY_NAMESPACE = "Emanuel-Calendar-App";
const LINKED_EVENT_ID_PROPERTY = `String {66f5a359-4659-4830-9070-00047ec6ac6e} Name ${EXTENDED_PROPERTY_NAMESPACE}_linkedEventId`;
const EVENT_TYPE_PROPERTY = `String {66f5a359-4659-4830-9070-00047ec6ac6f} Name ${EXTENDED_PROPERTY_NAMESPACE}_eventType`;

/**
 * Create linked events (main event + registration event) atomically
 * @param {string} accessToken - Microsoft Graph access token
 * @param {Object} mainEventData - Main event data
 * @param {Object} registrationEventData - Registration event data  
 * @param {string} mainCalendarId - Calendar ID for main event
 * @param {string} registrationCalendarId - Calendar ID for registration event
 * @returns {Object} Both created events with linking information
 */
export const createLinkedEvents = async (accessToken, mainEventData, registrationEventData, mainCalendarId, registrationCalendarId) => {
  try {
    const graphClient = getGraphClient(accessToken);
    
    // Create main event first
    const mainEventPath = mainCalendarId ? 
      `/me/calendars/${mainCalendarId}/events` : 
      '/me/events';
    
    const mainEvent = await graphClient.api(mainEventPath).post(mainEventData);
    
    // Create registration event with linking to main event
    const registrationEventPath = registrationCalendarId ? 
      `/me/calendars/${registrationCalendarId}/events` : 
      '/me/events';
    
    // Add extended properties to link events
    const linkedRegistrationEventData = {
      ...registrationEventData,
      singleValueExtendedProperties: [
        {
          id: LINKED_EVENT_ID_PROPERTY,
          value: mainEvent.id
        },
        {
          id: EVENT_TYPE_PROPERTY,
          value: "registration"
        }
      ]
    };
    
    const registrationEvent = await graphClient.api(registrationEventPath).post(linkedRegistrationEventData);
    
    // Update main event with linking to registration event
    const mainEventUpdateData = {
      singleValueExtendedProperties: [
        {
          id: LINKED_EVENT_ID_PROPERTY,
          value: registrationEvent.id
        },
        {
          id: EVENT_TYPE_PROPERTY,
          value: "main"
        }
      ]
    };
    
    await graphClient.api(`${mainEventPath}/${mainEvent.id}`).patch(mainEventUpdateData);
    
    return {
      mainEvent: {
        ...mainEvent,
        linkedEventId: registrationEvent.id,
        eventType: "main"
      },
      registrationEvent: {
        ...registrationEvent,
        linkedEventId: mainEvent.id,
        eventType: "registration"
      }
    };
    
  } catch (error) {
    console.error("Error creating linked events:", error);
    throw error;
  }
};

/**
 * Find linked event using extended properties
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} eventId - ID of the event to find linked event for
 * @param {string} calendarId - Calendar ID (optional)
 * @returns {Object|null} Linked event or null if not found
 */
export const findLinkedEvent = async (accessToken, eventId, calendarId = null) => {
  try {
    const graphClient = getGraphClient(accessToken);
    
    // First get the source event to find its linked event ID
    const eventPath = calendarId ? 
      `/me/calendars/${calendarId}/events/${eventId}` : 
      `/me/events/${eventId}`;
    
    const sourceEvent = await graphClient
      .api(eventPath)
      .expand(`singleValueExtendedProperties($filter=id eq '${LINKED_EVENT_ID_PROPERTY}' or id eq '${EVENT_TYPE_PROPERTY}')`)
      .get();
    
    if (!sourceEvent.singleValueExtendedProperties) {
      return null;
    }
    
    // Extract linked event ID
    const linkedEventIdProperty = sourceEvent.singleValueExtendedProperties.find(
      prop => prop.id === LINKED_EVENT_ID_PROPERTY
    );
    
    if (!linkedEventIdProperty) {
      return null;
    }
    
    const linkedEventId = linkedEventIdProperty.value;
    
    // Search for the linked event across all calendars
    const calendarsResponse = await graphClient.api('/me/calendars').get();
    
    for (const calendar of calendarsResponse.value) {
      try {
        const linkedEvent = await graphClient
          .api(`/me/calendars/${calendar.id}/events/${linkedEventId}`)
          .expand(`singleValueExtendedProperties($filter=id eq '${LINKED_EVENT_ID_PROPERTY}' or id eq '${EVENT_TYPE_PROPERTY}')`)
          .get();
        
        return {
          ...linkedEvent,
          calendarId: calendar.id,
          calendarName: calendar.name
        };
      } catch {
        // Event not in this calendar, continue searching
        continue;
      }
    }
    
    return null;
    
  } catch (error) {
    console.error("Error finding linked event:", error);
    return null;
  }
};

/**
 * Update linked event when source event changes
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} sourceEventId - ID of the event that was changed
 * @param {Object} sourceEventData - Updated event data
 * @param {string} sourceCalendarId - Calendar ID of source event
 * @param {number} setupMinutes - Setup time in minutes
 * @param {number} teardownMinutes - Teardown time in minutes
 * @returns {Object|null} Updated linked event or null if no linked event
 */
export const updateLinkedEvent = async (accessToken, sourceEventId, sourceEventData, sourceCalendarId, setupMinutes = 0, teardownMinutes = 0) => {
  try {
    // Find the linked event
    const linkedEvent = await findLinkedEvent(accessToken, sourceEventId, sourceCalendarId);
    
    if (!linkedEvent) {
      console.log('No linked event found for', sourceEventId);
      return null;
    }
    
    const graphClient = getGraphClient(accessToken);
    
    // Determine event types
    const sourceEventType = sourceEventData.singleValueExtendedProperties?.find(
      prop => prop.id === EVENT_TYPE_PROPERTY
    )?.value || "main";
    
    const linkedEventType = linkedEvent.singleValueExtendedProperties?.find(
      prop => prop.id === EVENT_TYPE_PROPERTY
    )?.value || "registration";
    
    let updatedEventData;
    
    if (sourceEventType === "main" && linkedEventType === "registration") {
      // Main event changed, update registration event with new setup/teardown times
      const sourceStart = new Date(sourceEventData.start.dateTime);
      const sourceEnd = new Date(sourceEventData.end.dateTime);
      
      const registrationStart = new Date(sourceStart.getTime() - (setupMinutes * 60 * 1000));
      const registrationEnd = new Date(sourceEnd.getTime() + (teardownMinutes * 60 * 1000));
      
      updatedEventData = {
        subject: `[SETUP/TEARDOWN] ${sourceEventData.subject}`,
        start: {
          dateTime: registrationStart.toISOString(),
          timeZone: sourceEventData.start.timeZone || 'UTC'
        },
        end: {
          dateTime: registrationEnd.toISOString(),
          timeZone: sourceEventData.end.timeZone || 'UTC'
        },
        location: sourceEventData.location
      };
      
    } else if (sourceEventType === "registration" && linkedEventType === "main") {
      // Registration event changed, update main event (removing setup/teardown)
      const sourceStart = new Date(sourceEventData.start.dateTime);
      const sourceEnd = new Date(sourceEventData.end.dateTime);
      
      const mainStart = new Date(sourceStart.getTime() + (setupMinutes * 60 * 1000));
      const mainEnd = new Date(sourceEnd.getTime() - (teardownMinutes * 60 * 1000));
      
      updatedEventData = {
        subject: sourceEventData.subject.replace(/^\[SETUP\/TEARDOWN\]\s*/, ''),
        start: {
          dateTime: mainStart.toISOString(),
          timeZone: sourceEventData.start.timeZone || 'UTC'
        },
        end: {
          dateTime: mainEnd.toISOString(),
          timeZone: sourceEventData.end.timeZone || 'UTC'
        },
        location: sourceEventData.location
      };
    }
    
    if (updatedEventData) {
      const linkedEventPath = `/me/calendars/${linkedEvent.calendarId}/events/${linkedEvent.id}`;
      const updatedEvent = await graphClient.api(linkedEventPath).patch(updatedEventData);
      
      console.log(`Updated linked ${linkedEventType} event:`, updatedEvent.id);
      return updatedEvent;
    }
    
    return null;
    
  } catch (error) {
    console.error("Error updating linked event:", error);
    throw error;
  }
};

/**
 * Delete linked event when source event is deleted
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} eventId - ID of the deleted event
 * @param {string} calendarId - Calendar ID of deleted event
 * @returns {boolean} Success indicator
 */
export const deleteLinkedEvent = async (accessToken, eventId, calendarId = null) => {
  try {
    // Find the linked event
    const linkedEvent = await findLinkedEvent(accessToken, eventId, calendarId);
    
    if (!linkedEvent) {
      console.log('No linked event found for deletion:', eventId);
      return false;
    }
    
    const graphClient = getGraphClient(accessToken);
    
    // Delete the linked event
    const linkedEventPath = `/me/calendars/${linkedEvent.calendarId}/events/${linkedEvent.id}`;
    await graphClient.api(linkedEventPath).delete();
    
    console.log('Successfully deleted linked event:', linkedEvent.id);
    return true;
    
  } catch (error) {
    console.error("Error deleting linked event:", error);
    return false;
  }
};

/**
 * Create a webhook subscription for calendar changes
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} notificationUrl - URL to receive webhook notifications
 * @param {string} calendarId - Calendar ID to monitor (optional, defaults to all calendars)
 * @returns {Object} Subscription details
 */
export const createCalendarWebhook = async (accessToken, notificationUrl, calendarId = null) => {
  try {
    const graphClient = getGraphClient(accessToken);
    
    // Set up subscription for calendar events
    const resource = calendarId ? 
      `/me/calendars/${calendarId}/events` : 
      '/me/events';
    
    const subscription = {
      changeType: 'created,updated,deleted',
      notificationUrl: notificationUrl,
      resource: resource,
      expirationDateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      clientState: 'emanuel-calendar-app-webhook'
    };
    
    const result = await graphClient.api('/subscriptions').post(subscription);
    
    console.log('Created webhook subscription:', result.id);
    return result;
    
  } catch (error) {
    console.error("Error creating calendar webhook:", error);
    throw error;
  }
};

/**
 * Renew a webhook subscription
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} subscriptionId - Subscription ID to renew
 * @returns {Object} Updated subscription details
 */
export const renewCalendarWebhook = async (accessToken, subscriptionId) => {
  try {
    const graphClient = getGraphClient(accessToken);
    
    const updateData = {
      expirationDateTime: new Date(Date.now() + 3600000).toISOString() // 1 hour from now
    };
    
    const result = await graphClient.api(`/subscriptions/${subscriptionId}`).patch(updateData);
    
    console.log('Renewed webhook subscription:', subscriptionId);
    return result;
    
  } catch (error) {
    console.error("Error renewing calendar webhook:", error);
    throw error;
  }
};

/**
 * Delete a webhook subscription
 * @param {string} accessToken - Microsoft Graph access token
 * @param {string} subscriptionId - Subscription ID to delete
 * @returns {boolean} Success indicator
 */
export const deleteCalendarWebhook = async (accessToken, subscriptionId) => {
  try {
    const graphClient = getGraphClient(accessToken);
    
    await graphClient.api(`/subscriptions/${subscriptionId}`).delete();
    
    console.log('Deleted webhook subscription:', subscriptionId);
    return true;
    
  } catch (error) {
    console.error("Error deleting calendar webhook:", error);
    return false;
  }
};

/**
 * Process webhook notification and sync linked events if needed
 * @param {Object} notification - Webhook notification payload
 * @param {string} accessToken - Microsoft Graph access token
 * @returns {boolean} Success indicator
 */
export const processWebhookNotification = async (notification, accessToken) => {
  try {
    console.log('Processing webhook notification:', notification);
    
    // Extract event information from notification
    const resourceData = notification.resourceData;
    if (!resourceData || !resourceData.id) {
      console.log('Invalid notification format, skipping');
      return false;
    }
    
    const eventId = resourceData.id;
    const changeType = notification.changeType;
    
    if (changeType === 'deleted') {
      // Handle deletion - try to delete linked event
      await deleteLinkedEvent(accessToken, eventId);
      return true;
    }
    
    if (changeType === 'created' || changeType === 'updated') {
      // For updates, we need to get the current event data and sync linked event
      const graphClient = getGraphClient(accessToken);
      
      try {
        // Get the updated event
        const updatedEvent = await graphClient
          .api(`/me/events/${eventId}`)
          .expand(`singleValueExtendedProperties($filter=id eq '${LINKED_EVENT_ID_PROPERTY}' or id eq '${EVENT_TYPE_PROPERTY}')`)
          .get();
        
        // Check if this event has a linked event
        const hasLinkedEvent = updatedEvent.singleValueExtendedProperties?.some(
          prop => prop.id === LINKED_EVENT_ID_PROPERTY
        );
        
        if (hasLinkedEvent) {
          console.log('Event has linked event, checking for sync requirements');
          
          // Get setup/teardown times from internal data (if available)
          // For webhook processing, we'll need to fetch these from your internal API
          // For now, we'll use default values or skip sync
          const setupMinutes = 30; // Default or fetch from internal data
          const teardownMinutes = 30; // Default or fetch from internal data
          
          // Update the linked event
          await updateLinkedEvent(
            accessToken,
            eventId,
            updatedEvent,
            null, // We don't know the calendar ID from webhook
            setupMinutes,
            teardownMinutes
          );
        }
        
        return true;
        
      } catch (eventError) {
        console.error('Error fetching event for webhook sync:', eventError);
        return false;
      }
    }
    
    return true;
    
  } catch (error) {
    console.error("Error processing webhook notification:", error);
    return false;
  }
};