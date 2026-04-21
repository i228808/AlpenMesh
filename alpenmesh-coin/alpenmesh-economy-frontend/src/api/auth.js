import { client } from './client'

export const authApi = {
  signup: ({ email, password, display_name }) =>
    client.post('/auth/signup', { email, password, display_name }),

  login: ({ email, password }) =>
    client.post('/auth/login', { email, password }),
}
