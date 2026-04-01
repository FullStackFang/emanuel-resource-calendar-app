// src/config/authConfig.js
// Azure CLI Deployment Workflow
// 1. npm run build
// 2. zip -r dist.zip dist OR Compress-Archive -Path dist\* -DestinationPath dist.zip -Force (PowerShell command)
// Optional: az webapp deployment source delete --resource-group DefaultResourceGroup-EUS --name emanuEl-resourceScheduler
// 3. az webapp deploy --resource-group DefaultResourceGroup-EUS --name emanuEl-resourceScheduler --src-path dist.zip
export const APP_ID = 'c2187009-796d-4fea-b58c-f83f7a89589e';
export const OBJECT_ID = 'ed86ca1a-8acc-4250-b700-6c563a0c056f';
export const TENANT_ID = 'fcc71126-2b16-4653-b639-0f1ef8332302';

export const msalConfig = {
    auth: {
      clientId: APP_ID,
      authority: 'https://login.microsoftonline.com/fcc71126-2b16-4653-b639-0f1ef8332302',
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin
    },
    cache: {
      cacheLocation: "sessionStorage",
      storeAuthStateInCookie: false,
    }
  };
  
  // for login requests
  export const loginRequest = {
    scopes: ["User.Read", "Calendars.Read", "Calendars.ReadWrite", "Calendars.Read.Shared", "Calendars.ReadWrite.Shared"]
  };

  // for your custom API
  export const apiRequest = {
    scopes: [
      "api://c2187009-796d-4fea-b58c-f83f7a89589e/access_as_user",
      "offline_access"   // if you want a refresh token
    ]
  };
  
  export const graphConfig = {
    graphMeEndpoint: "https://graph.microsoft.com/v1.0/me",
    graphCalendarEndpoint: "https://graph.microsoft.com/v1.0/me/calendar",
    graphEventsEndpoint: "https://graph.microsoft.com/v1.0/me/events"
  };