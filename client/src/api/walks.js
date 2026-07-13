import { get, post, patch, del } from './client.js';

export const listWalks = (cursor) => get(cursor ? `/walks?cursor=${encodeURIComponent(cursor)}` : '/walks');
export const getWalk           = (id)    => get(`/walks/${id}`);
export const getFolioInsight   = ()      => get('/folio/insight');
export const submitBriefDraft  = (brief) => post('/walks/draft', brief);
export const deleteWalk        = (id)    => del(`/walks/${id}`);
export const setWalkStatus     = (id, status) => patch(`/walks/${id}/status`, { status });
