import { WAMessageContent } from 'baileys'
import { GlideClient } from '@valkey/valkey-glide'
import { MongoClient } from 'mongodb'
import {
  VALKEY_HOST,
  VALKEY_PORT,
  MONGODB_DATABASE,
  MONGODB_URL,
} from './config'

let valkeyClient: GlideClient | null = null
const mongoClient = new MongoClient(MONGODB_URL)

async function initValkeyClient() {
  valkeyClient = await GlideClient.createClient({
    addresses: [{ host: VALKEY_HOST, port: VALKEY_PORT }],
    requestTimeout: 10_000,
  })
}

export async function loadMessage(
  remoteJid: string,
  id: string,
): Promise<WAMessageContent | undefined> {
  const db = mongoClient.db(MONGODB_DATABASE)
  const collection = db.collection('messages')
  if (!valkeyClient) {
    await initValkeyClient()
  }
  const key = `m:${remoteJid}:${id}`
  const message = await valkeyClient!.get(key)
  if (message) {
    return JSON.parse(message as string) as WAMessageContent
  }
  const messageData = await collection.findOne({
    'key.id': id,
    'key.remoteJid': remoteJid,
  })
  if (messageData) {
    const { _id, ...message } = messageData
    await valkeyClient!.set(key, JSON.stringify(message))
    return message
  }
  return undefined
}

export async function saveMessage(message: any) {
  const db = mongoClient.db(MONGODB_DATABASE)
  const collection = db.collection('messages')
  if (!valkeyClient) {
    await initValkeyClient()
  }
  const {
    key: { id, remoteJid },
  } = message
  const key = `m:${remoteJid}:${id}`
  await valkeyClient!.set(key, JSON.stringify(message))
  await collection.insertOne(message)
}
