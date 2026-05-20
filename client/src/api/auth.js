import { get, post, patch } from './client.js';

export const signup = (email, password, anthropicApiKey) =>
  post('/auth/signup', { email, password, anthropicApiKey });

export const login = (email, password) =>
  post('/auth/login', { email, password });

export const logout = () =>
  post('/auth/logout', {});

export const me = () =>
  get('/auth/me');

export const rotateApiKey = (anthropicApiKey) =>
  patch('/auth/api-key', { anthropicApiKey });
