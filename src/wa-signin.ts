import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from 'baileys'
import P from 'pino'
import { type Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import fs from 'fs/promises'
import path from 'path'
import { SESSION_DIR } from './config'

async function main() {
  const phone = process.argv[2]

  if (!phone) {
    console.log('node wa-sign.js WAAccount')
    process.exit()
  }
  const { version } = await fetchLatestBaileysVersion()

  const sessionPath = path.join(SESSION_DIR, phone)
  await fs.mkdir(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)

  const sock = makeWASocket({
    auth: state,
    version,
    logger: P(),
  })

  sock.ev.on('creds.update', saveCreds)
  sock.ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log(await QRCode.toString(qr, { type: 'terminal' }))
    }
    if (connection === 'close') {
      if (
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut
      ) {
        main()
        return
      }
      console.log('Connection closed, you are logged out')
      await fs.rm(sessionPath, { recursive: true })
    }
  })
  sock.ev.on('messages.upsert', async () => {
    setTimeout(() => process.exit(), 10_000)
  })
}

main()
