import { get, post } from './client.js';

export const getAgentRun  = (id)        => get(`/agent-runs/${id}`);
export const submitReply  = (id, reply) => post(`/agent-runs/${id}/reply`, { reply });
export const abortRun     = (id)        => post(`/agent-runs/${id}/abort`, {});
