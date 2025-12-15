import {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
} from 'baileys'
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
  const { error, version } = await fetchLatestBaileysVersion()
  if (error) {
    console.log(`session: ${phone} | No connection, check your internet`)
    process.exit()
  }

  const sessionPath = path.join(SESSION_DIR, phone)
  await fs.mkdir(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)

  const sock = makeWASocket({
    auth: state,
    version,
  })

  sock.ev.process(async (events) => {
    if (events['creds.update']) {
      await saveCreds()
      return
    }

    if (events['connection.update']) {
      const { connection, lastDisconnect, qr } = events['connection.update']
      if (qr) {
        console.log(await QRCode.toString(qr, { type: 'terminal' }))
        return
      }

      if (
        connection === 'close' &&
        (lastDisconnect?.error as Boom)?.output?.statusCode ===
          DisconnectReason.restartRequired
      ) {
        main()
        return
      }

      if (connection === 'open') {
        console.log('Opened connection')
        setTimeout(() => process.exit(), 10_000)
        return
      }
    }
  })
}

main()
