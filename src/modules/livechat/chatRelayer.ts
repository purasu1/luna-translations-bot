import { tryOrDefault } from '../../helpers/tryCatch'
import { DexFrame, isPublic, VideoId, YouTubeChannelId } from '../holodex/frames'
import { findTextChannel, send } from '../../helpers/discord'
import { Snowflake, TextChannel, ThreadChannel } from 'discord.js'
import { addToGuildRelayHistory, getGuildData, getAllSettings, addToBotRelayHistory } from '../../core/db/functions'
import { GuildSettings, WatchFeature, WatchFeatureSettings } from '../../core/db/models'
import { retryIfStillUpThenPostLog } from './closeHandler'
import { logCommentData } from './logging'
import { frameEmitter } from '../holodex/frameEmitter'
import { isMainThread, MessageChannel } from 'worker_threads'
import { resolve } from 'path'
import { Task } from './chatRelayerWorker'
import {client} from '../../core'
import {log} from '../../helpers'
const Piscina = require ('piscina')

const piscina = new Piscina ({
  filename: resolve(__dirname, 'chatRelayerWorker.js'),
  useAtomics: false,
  idleTimeout: 99999999
})

if (isMainThread) frameEmitter.on ('frame', (frame: DexFrame) => {
  if (isPublic (frame)) setupRelay (frame)
})

const masterchats: Record<VideoId, any> = {} // Figure out why MessagePort type broken

export async function setupRelay (frame: DexFrame): Promise<void> {
  if (masterchats[frame.id]) {
    masterchats[frame.id].postMessage ({
      _tag: 'FrameUpdate',
      status: frame.status
    })
    return
  }
  
  const { port1, port2 } = new MessageChannel ()

  masterchats[frame.id] = port2
  
  piscina.run ({ port: port1, frame, allEntries }, { transferList: [port1] })

  port2.on ('message', runTask)
}

export interface ChatComment {
  id:      string
  name:    string
  body:    string
  time:    number
  isMod:   boolean
  isOwner: boolean
}

export type Entry = [GuildSettings, Blacklist, WatchFeature, WatchFeatureSettings]
export type Entries = Entry[]
export type Blacklist = Set<YouTubeChannelId>

///////////////////////////////////////////////////////////////////////////////

const features: WatchFeature[] = ['relay', 'cameos', 'gossip']
let allEntries: [GuildSettings, Blacklist, WatchFeature, WatchFeatureSettings][] = []

setInterval (() => {
  const guilds = getAllSettings ()

  allEntries = guilds.flatMap (g => features.flatMap (f => g[f].map (e => {
    const bl = new Set (g.blacklist.map (i => i.ytId))
    return [g, bl, f, e] as Entry
  })))

  Object.values (masterchats).forEach (port => port.postMessage ({
    _tag: 'EntryUpdate',
    entries: allEntries
  }))
}, 5000)

function runTask (task: Task): void {
  if (task._tag === 'EndTask') {
    delete masterchats[task.frame.id]
    retryIfStillUpThenPostLog (task.frame, task.errorCode)
  }
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

    log (`${task.vId} | ${task.content}`)
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
      })}
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
