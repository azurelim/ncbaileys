import {
  fetchLatestBaileysVersion,
  makeWASocket,
  downloadMediaMessage,
  useMultiFileAuthState,
  WAMessageKey,
  WAMessageContent,
  DisconnectReason,
} from 'baileys'
import P from 'pino'
import { type Boom } from '@hapi/boom'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs/promises'
import path from 'path'
import { connect, StringCodec } from 'nats'
import { uploadMedia } from './utils'
import { LOG_DIR, NATS_SERVERS, NATS_TOKEN, SESSION_DIR } from './config'
import { loadMessage, saveMessage } from './valkey-mongo-store'

export const sock: any = {}
export const sockReady: any = {}

export async function startSock(session: string) {
  const { version } = await fetchLatestBaileysVersion()

  const sessionPath = path.join(SESSION_DIR, session)
  await fs.mkdir(sessionPath, { recursive: true })

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)

  sock[session] = makeWASocket({
    auth: state,
    version,
    logger: P(),
    getMessage: async (
      key: WAMessageKey,
    ): Promise<WAMessageContent | undefined> => {
      return loadMessage(key.remoteJid!, key.id!)
    },
  })

  sock[session].ev.on('creds.update', saveCreds)
  sock[session].ev.on('connection.update', async (update: any) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      sockReady[session] = false
      if (
        (lastDisconnect?.error as Boom)?.output?.statusCode !==
        DisconnectReason.loggedOut
      ) {
        startSock(session)
      } else {
        console.log('Connection closed. You are logged out.')
        await fs.rm(sessionPath, { recursive: true })
      }
    }
  })

  sock[session].ev.on('messages.upsert', async (m: any) => {
    sockReady[session] = true
    const uuid = uuidv4()
    const timestamp = new Date().getTime()
    const messageFilePath = path.join(
      LOG_DIR,
      `messages-${timestamp}-${uuid}.json`,
    )
    await fs.writeFile(messageFilePath, Buffer.from(JSON.stringify(m, null, 2)))
    saveMessage(m.messages[0])
    const publishedMessage = JSON.parse(JSON.stringify(m))
    if (!m.messages[0].message) {
      return
    }
    if (m.messages[0].key.remoteJid.endsWith('@g.us')) {
      const metadata = await sock[session].groupMetadata(
        m.messages[0].key.remoteJid,
      )
      publishedMessage.messages[0].key['subject'] = metadata.subject
    }
    if (m.messages[0].message.imageMessage) {
      const buffer = await downloadMediaMessage(m.messages[0], 'buffer', {})
      const media = await uploadMedia({
        name: 'image',
        mimeType: m.messages[0].message.imageMessage.mimetype,
        buffer,
      })
      publishedMessage.messages[0].message.imageMessage['id'] = media.id
    } else if (m.messages[0].message.videoMessage) {
      const buffer = await downloadMediaMessage(m.messages[0], 'buffer', {})
      const media = await uploadMedia({
        name: 'video',
        mimeType: m.messages[0].message.videoMessage.mimetype,
        buffer,
      })
      publishedMessage.messages[0].message.videoMessage['id'] = media.id
    } else if (m.messages[0].message.documentWithCaptionMessage) {
      const buffer = await downloadMediaMessage(m.messages[0], 'buffer', {})
      const media = await uploadMedia({
        name: m.messages[0].message.documentWithCaptionMessage.message
          .documentMessage.fileName,
        mimeType:
          m.messages[0].message.documentWithCaptionMessage.message
            .documentMessage.mimetype,
        buffer,
      })
      publishedMessage.messages[0].message.documentWithCaptionMessage.message.documentMessage[
        'id'
      ] = media.id
    }
    const nc = await connect({
      servers: NATS_SERVERS,
      token: NATS_TOKEN,
    })
    const js = nc.jetstream()
    const sc = StringCodec()
    await js.publish(
      `events.ncbaileys.${session}.messages_received`,
      sc.encode(JSON.stringify(publishedMessage)),
    )
    await nc.close()
    return
  })
}
