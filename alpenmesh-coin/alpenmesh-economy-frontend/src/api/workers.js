import { client } from './client'

export const workersApi = {
  register: ({ worker_id, worker_secret }) =>
    client.post('/workers/register', { worker_id, worker_secret }),

  earnings: (workerId) => client.get(`/workers/${workerId}`),

  proofs: (workerId) => client.get(`/workers/${workerId}/proofs`),

  bindWallet: (workerId, { wallet_address }) =>
    client.post(`/workers/${workerId}`, { wallet_address }),
}
