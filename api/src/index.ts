// Azure Functions v4 programming model entry point (package.json "main" points
// at the compiled dist/src/index.js). Importing these modules registers every
// HTTP endpoint and the genjobs queue worker with the host.
import './functions/http-admin'
import './functions/http-framework'
import './functions/http-sets'
import './functions/http-scopes'
import './functions/worker'
