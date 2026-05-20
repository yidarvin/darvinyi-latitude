import { get } from './client.js';

export const listWalks = () => get('/walks');
export const getWalk = (id) => get(`/walks/${id}`);
export const getFolioInsight = () => get('/folio/insight');
