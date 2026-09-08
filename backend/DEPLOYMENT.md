# Backend deployment

Deployments are run by the user, never by an agent.

From `backend`, run `npm run package:deploy` to generate build metadata and
create `../backend.zip` locally. This command does not contact Azure. The ZIP
contains the backend files at its root, including `.deployment`, and excludes
local environment files, dependencies, tests, logs, and Azure CLI defaults.

When ready, the user runs `npm run deploy` from `backend`. It builds the same
ZIP and uploads it to the existing `emanuelnyc-services-api` app using
`az webapp deploy`. It does not create an app, update the App Service plan,
change the runtime, or configure logging. Azure build automation must already
be enabled (`SCM_DO_BUILD_DURING_DEPLOYMENT=true`); it installs dependencies
on the server. This setting was confirmed enabled on September 8, 2026.

Keep app settings, runtime, scaling, and other management changes separate
from deployment. The previous `az webapp up` workflow mixed those operations
with the ZIP upload; the September 8 failure reported an SCM container
restart interrupting deployment.

If the CLI times out, check the server-side result before retrying:

```powershell
az webapp log deployment list -g DefaultResourceGroup-EUS -n emanuelnyc-services-api
az webapp log deployment show -g DefaultResourceGroup-EUS -n emanuelnyc-services-api
Invoke-RestMethod 'https://emanuelnyc-services-api-c9efd3ajhserccff.canadacentral-01.azurewebsites.net/api/version'
```

Kudu status `3` is failure; `4` is success. Confirm the served commit matches
the generated build metadata. Ctrl+C stops the local CLI; it does not guarantee
that Azure has cancelled the server-side deployment. Do not overlap attempts.
