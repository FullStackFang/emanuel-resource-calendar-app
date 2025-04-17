// src/config/authConfig.js
export const msalConfig = {
    auth: {
      clientId: "c2187009-796d-4fea-b58c-f83f7a89589e",
      authority: 'https://login.microsoftonline.com/fcc71126-2b16-4653-b639-0f1ef8332302',
      redirectUri: 'httpS://localhost:3000',
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    }
  };
  
  export const loginRequest = {
    scopes: ["User.Read", "Calendars.Read", "Calendars.ReadWrite"]
  };
  
  export const graphConfig = {
    graphMeEndpoint: "https://graph.microsoft.com/v1.0/me",
    graphCalendarEndpoint: "https://graph.microsoft.com/v1.0/me/calendar",
    graphEventsEndpoint: "https://graph.microsoft.com/v1.0/me/events"
  };