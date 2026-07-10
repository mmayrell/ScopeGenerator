// Azure Functions v4 programming model entry point (package.json "main" points
// at the compiled dist/src/index.js). Importing these modules registers every
// HTTP endpoint and the genjobs queue worker with the host.
import './functions/http-admin'
import './functions/http-evals'
import './functions/http-framework'
import './functions/http-library'
import './functions/http-lsg'
import './functions/http-packets'
import './functions/http-sets'
import './functions/http-scopes'
import './functions/http-vsg'
import './functions/worker'
