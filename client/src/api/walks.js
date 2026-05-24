import { get, post, del } from './client.js';

export const listWalks         = ()      => get('/walks');
export const getWalk           = (id)    => get(`/walks/${id}`);
export const getFolioInsight   = ()      => get('/folio/insight');
export const submitBriefDraft  = (brief) => post('/walks/draft', brief);
export const deleteWalk        = (id)    => del(`/walks/${id}`);
