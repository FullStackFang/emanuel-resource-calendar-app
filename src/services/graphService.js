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