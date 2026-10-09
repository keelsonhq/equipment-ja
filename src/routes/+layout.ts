// The UI renders in the browser and reads everything through /api (the single
// boundary where authentication, authorization and history live). The HTML
// shell carries no data.
export const ssr = false;
export const prerender = false;
