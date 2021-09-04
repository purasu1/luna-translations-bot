import { doNothing } from '../../helpers'
import { tryOrDefault } from '../../helpers/tryCatch'
import { DexFrame, isPublic, VideoId } from '../holodex/frames'
import { getChatProcess } from './chatProcesses'
import { findTextChannel, send } from '../../helpers/discord'
import { Snowflake, TextChannel, ThreadChannel } from 'discord.js'
import { addToGuildRelayHistory, getGuildData, getAllSettings } from '../../core/db/functions'
import { GuildSettings } from '../../core/db/models'
import { retryIfStillUpThenPostLog } from './closeHandler'
import { logCommentData } from './logging'
import { frameEmitter } from '../holodex/frameEmitter'
import { isMainThread } from 'worker_threads'
import { resolve } from 'path'
import { Task } from './chatRelayerWorker'
const Piscina = require ('piscina')

const piscina = new Piscina ({
  filename: resolve(__dirname, 'chatRelayerWorker.js'),
  idleTimeout: 99999999
})

if (isMainThread) frameEmitter.on ('frame', (frame: DexFrame) => {
  if (isPublic (frame)) setupRelay (frame)
})

export function setupRelay (frame: DexFrame): void {
  const chat = getChatProcess (frame.id)

  chat.stdout.removeAllListeners ('data')
  // chat.stdout.on ('data', data => processComments (frame, data))
  chat.stdout.on ('data', async data => {
    const tasks: Task[] = await piscina.run ({
      frame,
      cmts: extractComments(data),
      guilds,
    })
    tasks.forEach (runTask)
  })

  chat.removeAllListeners ('close')
  chat.on ('close', exitCode => retryIfStillUpThenPostLog (frame, exitCode))
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

let guilds: GuildSettings[] = [] // Simple caching
setInterval (() => guilds = getAllSettings (), 5000)

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
            task.g._id,
            msg.id
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
  const addFn = type === 'guild' ? addToGuildRelayHistory : doNothing
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
