import { get, post } from './client.js';

export const getAgentRun    = (id)          => get(`/agent-runs/${id}`);
export const listAgentRuns  = ()            => get('/agent-runs?status=active,awaiting_user');
export const submitReply    = (id, reply)   => post(`/agent-runs/${id}/reply`, { reply });
export const refineRun      = (id, message) => post(`/agent-runs/${id}/refine`, { message });
export const abortRun       = (id)          => post(`/agent-runs/${id}/abort`, {});
