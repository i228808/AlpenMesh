import { client } from './client'

export const usersApi = {
  portfolio: (userId) => client.get(`/users/${userId}`),

  connectWallet: (userId, { wallet_address, network }) =>
    client.post(`/users/${userId}/wallet`, { wallet_address, network }),

  connectWorker: (userId, { worker_id, worker_secret, label }) =>
    client.post(`/users/${userId}/workers`, { worker_id, worker_secret, label }),
}
