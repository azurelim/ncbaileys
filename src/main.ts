import { serve } from '@hono/node-server'
import { startSock, sock, sockReady } from './socket.service'
import app from './hono'

import { PORT, WA_ACCOUNTS } from './config'

const accounts: string[] = JSON.parse(WA_ACCOUNTS as string)

accounts.forEach((account) => {
  sock[account] = null
  sockReady[account] = false
  startSock(account).catch((err) => console.log('Unexpected error:', err))
})

serve({
  fetch: app.fetch,
  port: Number(PORT),
})
