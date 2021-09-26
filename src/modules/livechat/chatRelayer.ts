import { doNothing } from '../../helpers'
import { tryOrDefault } from '../../helpers/tryCatch'
import { DexFrame, isPublic, VideoId } from '../holodex/frames'
import { getChatProcess } from './chatProcesses'
import { findTextChannel, send } from '../../helpers/discord'
import { Snowflake, TextChannel, ThreadChannel } from 'discord.js'
import { addToGuildRelayHistory, getGuildData, getAllSettings, addToBotRelayHistory } from '../../core/db/functions'
import { GuildSettings, WatchFeature, WatchFeatureSettings } from '../../core/db/models'
import { retryIfStillUpThenPostLog } from './closeHandler'
import { logCommentData } from './logging'
import { frameEmitter } from '../holodex/frameEmitter'
import { isMainThread } from 'worker_threads'
import { resolve } from 'path'
import { Task } from './chatRelayerWorker'
import { AddChatItemAction, runsToString } from 'masterchat'
const Piscina = require ('piscina')

const piscina = new Piscina ({
  filename: resolve(__dirname, 'chatRelayerWorker.js'),
  idleTimeout: 99999999
})

if (isMainThread) frameEmitter.on ('frame', (frame: DexFrame) => {
  if (isPublic (frame)) setupRelay (frame)
})

function toChatComments(chats: AddChatItemAction[]) : ChatComment[] {
  return chats.map(chat => ({
    id: chat.authorChannelId,
    name: chat.authorName,
    body: runsToString(chat.rawMessage, {spaces:true}),
    time: chat.timestamp.getTime(),
    isMod: chat.isModerator,
    isOwner: chat.isOwner
  }))
}

export async function setupRelay (frame: DexFrame): Promise<void> {
  const chat = getChatProcess (frame.id, frame.channel.id)

  chat.removeAllListeners ('chats')
  chat.removeAllListeners ('error')

  chat.on ('chats', async chats => {
    const cmts = toChatComments(chats)
    const tasks: Task[] = await piscina.run ({
      frame,
      cmts,
      allEntries
    })
    tasks.forEach (runTask)
  })

  chat.on ('error', (error) => retryIfStillUpThenPostLog (frame, error))

  // chat.on ('end', (reason) => {
  //   console.log('stream ended');
  // })

  chat.listen({ignoreFirstResponse: true})
}

export interface ChatComment {
  id:      string
  name:    string
  body:    string
  time:    number
  isMod:   boolean
  isOwner: boolean
}

///////////////////////////////////////////////////////////////////////////////

const features: WatchFeature[] = ['relay', 'cameos', 'gossip']
let allEntries: [GuildSettings, WatchFeature, WatchFeatureSettings][] = []

setInterval (() => {
  const guilds = getAllSettings ()
  allEntries = guilds.flatMap (g => features.flatMap (f => g[f].map (e =>
    [g, f, e] as [GuildSettings, WatchFeature, WatchFeatureSettings]
  )))
}, 5000)

function runTask (task: Task): void {
  if (task._tag === 'LogCommentTask') {
    logCommentData (task.cmt, task.frame, task.streamer)
  }
  if (task._tag === 'SaveMessageTask') {
    saveComment (task.comment, task.frame, task.type, task.msgId, task.chId)
  }
  if (task._tag === 'SendMessageTask') {
    const ch = findTextChannel (task.cid)
    const thread = task.tlRelay
      ? findFrameThread (task.vId, task.g)
      : null
      send (thread ?? ch, task.content)
      .then (msg => {
        if (task.save && msg) {
          saveComment (
            task.save.comment,
            task.save.frame,
            'guild',
            msg.id,
            msg.channelId,
            task.g._id,
          )
        }
      })
  }
}

export function findFrameThread (
  videoId: VideoId, g: GuildSettings, channel?: TextChannel | ThreadChannel
): ThreadChannel | undefined {
  const gdata  = getGuildData (g._id)
  const notice = gdata.relayNotices.get (videoId)
  const validch = channel as TextChannel
  if (g.threads) return validch?.threads?.cache.find (thr => thr.id === notice)
}

function saveComment (
  cmt: ChatComment,
  frame: DexFrame,
  type: 'guild'|'bot',
  msgId?: Snowflake,
  chId?: Snowflake,
  gid?: Snowflake,
): void {
  const addFn = type === 'guild' ? addToGuildRelayHistory : addToBotRelayHistory
  const startTime  = new Date (Date.parse (frame.start_actual ?? '')).valueOf ()
  const loggedTime = new Date (+cmt.time).valueOf ()
  const timestamp  = !frame.start_actual
                     ? 'prechat'
                     : new Date (loggedTime - startTime)
                       .toISOString ()
                       .substr (11, 8)
  addFn (frame.id, {
    msgId:        msgId,
    discordCh:    chId,
    body:         cmt.body,
    ytId:         cmt.id,
    author:       cmt.name,
    timestamp,
    stream:       frame.id,
    absoluteTime: cmt.time
  }, gid!)
}

function extractComments (jsonl: any): ChatComment[] {
  const cmts = String (jsonl)
    .split ('\n')
    .filter (x => x !== '')
  return tryOrDefault (() => cmts.map (cmt => JSON.parse (cmt)), [])
}
