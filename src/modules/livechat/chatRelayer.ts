import { DexFrame, isPublic, VideoId, YouTubeChannelId } from '../holodex/frames'
import { findTextChannel, send } from '../../helpers/discord'
import { Snowflake, TextChannel, ThreadChannel } from 'discord.js'
import {
  addToGuildRelayHistory,
  getGuildData,
  getAllSettings,
  addToBotRelayHistory,
} from '../../core/db/functions'
import { GuildSettings, WatchFeature, WatchFeatureSettings } from '../../core/db/models'
import { retryIfStillUpThenPostLog, sendAndForgetHistory } from './closeHandler'
import { logCommentData } from './logging'
import { frameEmitter } from '../holodex/frameEmitter'
import { isMainThread, MessageChannel } from 'worker_threads'
import { resolve } from 'path'
import { processComments, Task } from './chatRelayerWorker'
import { io } from 'socket.io-client'
import { debug, log } from '../../helpers'
// const Piscina = require('piscina')

// const piscina = new Piscina({
  // filename: resolve(__dirname, 'chatRelayerWorker.js'),
  // useAtomics: false,
  // idleTimeout: 99999999,
// })

if (isMainThread)
  frameEmitter.on('frame', (frame: DexFrame) => {
    if (isPublic(frame)) {
      if (frame.status === 'live') {
        setupLive(frame)
      } else {
        //setupRelay(frame)
        log(`${frame.id} is upcoming, not relaying`)
      }
    }
  })

const masterchats: Record<VideoId, any> = {} // Figure out why MessagePort type broken

// export async function setupRelay(frame: DexFrame): Promise<void> {
  // const { port1, port2 } = new MessageChannel()

  // masterchats[frame.id] = port2

  // piscina.run({ port: port1, frame, allEntries }, { transferList: [port1] })

  // port2.on('message', runTask)
// }

// TODO: ensure no race condition getting live frames on startup
const framesAwaitingSub: Record<VideoId, DexFrame> = {}
const activeSubs: Set<VideoId> = new Set()

const tldex = io('wss://holodex.net', {
  path: '/api/socket.io/',
  transports: ['websocket'],
})

tldex.on('connect_error', (err) => debug(err))

// resubscribe on server restart
tldex.on('connect', () => {
  activeSubs.forEach((sub) => {
    tldex.emit('subscribe', { video_id: sub, lang: 'en' })
  })
})

tldex.on('subscribeSuccess', (msg) => {
  delete framesAwaitingSub[msg.id]
  activeSubs.add(msg.id)
  if (masterchats[msg.id]) {
    masterchats[msg.id].postMessage({
      _tag: 'FrameUpdate',
      status: 'live',
    })
    return
  }

  debug('subsucc ' + JSON.stringify(msg))
})

tldex.on('subscribeError', (msg) => {
  retries[msg.id] = (retries[msg.id] ?? 0) + 1
  if (retries[msg.id] < 5) {
    setTimeout(() => setupLive(framesAwaitingSub[msg.id]), 30000)
  } else {
    delete retries[msg.id]
  }
})

tldex.onAny((evtName, ...args) => {
  // if (!evtName.includes ('/en') && evtName !== 'subscribeSuccess') {
  debug(evtName + ': ' + JSON.stringify(args))
  // }
})

const retries: Record<VideoId, number> = {}
function setupLive(frame: DexFrame) {
  if (frame == null) return
  debug(`setting up ${frame.status} ${frame.id} ${frame.title}`)
  framesAwaitingSub[frame.id] = frame
  tldex.emit('subscribe', { video_id: frame.id, lang: 'en' })
  ;(tldex as any).removeAllListeners?.(`${frame.id}/en`)
  tldex.on(`${frame.id}/en`, async (msg) => {
    //debug(`Received a message in ${frame.id}: ${JSON.stringify(msg)}`)
    if (msg.name) {
      const cmt: ChatComment = {
        id: msg.channel_id ?? 'MChad-' + msg.name,
        name: msg.name,
        body: msg.message.replace(/:http\S+( |$)/g, ':'),
        time: msg.timestamp,
        isMod: msg.is_moderator,
        isOwner: msg.channel_id === frame.channel.id,
        isTl: msg.is_tl || msg.source === 'MChad',
        isV: msg.is_vtuber,
      }
      const tasks = await processComments(frame, [cmt], allEntries)
      tasks.forEach(runTask)
    } else if (msg.type === 'end') {
      activeSubs.delete(frame.id)
      sendAndForgetHistory(frame.id)
    }
  })
}

export interface ChatComment {
  id: string
  name: string
  body: string
  time: number
  isMod: boolean
  isOwner: boolean
  isTl?: boolean
  isV?: boolean
}

export type Entry = [GuildSettings, Blacklist, WatchFeature, WatchFeatureSettings]
export type Entries = Entry[]
export type Blacklist = Set<YouTubeChannelId>

///////////////////////////////////////////////////////////////////////////////

const features: WatchFeature[] = ['relay', 'cameos', 'gossip']
let allEntries: [GuildSettings, Blacklist, WatchFeature, WatchFeatureSettings][] = []

async function updateEntries() {
  const guilds = getAllSettings()
  allEntries = guilds.flatMap((g) =>
    features.flatMap((f) =>
      g[f].map((e) => {
        const bl = new Set(g.blacklist.map((i) => i.ytId))
        return [g, bl, f, e] as Entry
      }),
    ),
  )

  Object.values(masterchats).forEach((port) =>
    port.postMessage({
      _tag: 'EntryUpdate',
      entries: allEntries,
    }),
  )
}

setInterval(updateEntries, 10000)

updateEntries()

async function runTask(task: Task): Promise<void> {
  if (task._tag === 'EndTask') {
    delete masterchats[task.frame.id]
    if (!task.wentLive) retryIfStillUpThenPostLog(task.frame, task.errorCode)
  }
  if (task._tag === 'LogCommentTask') {
    logCommentData(task.cmt, task.frame, task.streamer)
  }
  if (task._tag === 'SaveMessageTask') {
    log('Saving data...')
    saveComment(task.comment, task.frame, task.type, task.msgId, task.chId)
    log('Done saving data.')
  }
  if (task._tag === 'SendMessageTask') {
    const ch = findTextChannel(task.cid)
    const thread = task.tlRelay ? await findFrameThread(task.vId, task.g) : null

    log(`${task.vId} | ${task.content}`);
    // const lastMsg = ch?.lastMessage
    // const isBotLastPoster = lastMsg?.author?.id === client.user?.id
    // // // this code is ugly and duplicated but im in a hurry
    // if (isBotLastPoster) {
    // tryOrLog (() => {
    // lastMsg?.edit(`${lastMsg.content}\n${task.content}`)
    // .then (msg => {
    // if (task.save && msg) {
    // saveComment (
    // task.save.comment,
    // task.save.frame,
    // 'guild',
    // msg.id,
    // msg.channelId,
    // task.g._id,
    // )
    // }
    // })
    // .catch (() => {
    // send (thread ?? ch, task.content)
    // .then (msg => {
    // if (task.save && msg) {
    // saveComment (
    // task.save.comment,
    // task.save.frame,
    // 'guild',
    // msg.id,
    // msg.channelId,
    // task.g._id,
    // )
    // }
    // })
    // })
    // })
    // } else {
    
    ({ ch, thread });
    // DISABLED 2022-10-12
    send(thread ?? ch, task.content).then((msg) => {
      if (task.save && msg) {
        saveComment(task.save.comment, task.save.frame, 'guild', msg.id, msg.channelId, task.g._id)
      }
    })
    // }
  }
}

export async function findFrameThread(
  videoId: VideoId,
  g: GuildSettings,
  channel?: TextChannel | ThreadChannel,
): Promise<ThreadChannel | undefined> {
  const gdata = await getGuildData(g._id)
  const notice = gdata.relayNotices.get(videoId)
  const validch = channel as TextChannel
  if (g.threads) return validch?.threads?.cache.find((thr) => thr.id === notice)
}

function saveComment(
  cmt: ChatComment,
  frame: DexFrame,
  type: 'guild' | 'bot',
  msgId?: Snowflake,
  chId?: Snowflake,
  gid?: Snowflake,
): void {
  const addFn = type === 'guild' ? addToGuildRelayHistory : addToBotRelayHistory
  const startTime = new Date(Date.parse(frame.start_actual ?? '')).valueOf()
  const loggedTime = new Date(+cmt.time).valueOf()
  const timestamp = !frame.start_actual
    ? 'prechat'
    : new Date(loggedTime - startTime).toISOString().substr(11, 8)
  debug('saving comment...')
  addFn(
    frame.id,
    {
      msgId: msgId,
      discordCh: chId,
      body: cmt.body,
      ytId: cmt.id,
      author: cmt.name,
      timestamp,
      stream: frame.id,
      absoluteTime: cmt.time,
    },
    gid!,
  )
  debug('saving comment finished')
}
