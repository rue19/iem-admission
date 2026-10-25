// The API is always on the same origin as the app: on Vercel both are served
// from one domain, and locally `ng serve` forwards /api to localhost:3000
// (see proxy.conf.json). So no component hard-codes a host.
export const environment = {
  apiUrl: '/api',
};
