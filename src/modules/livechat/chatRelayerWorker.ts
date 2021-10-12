import { ciEquals, doNothing, match } from '../../helpers'
import { DexFrame } from '../holodex/frames'
import { Streamer, StreamerName, streamers, streamersMap } from '../../core/db/streamers'
import { emoji } from '../../helpers/discord'
import { Snowflake } from 'discord.js'
import { tl } from '../deepl'
import { isBlacklistedOrUnwanted, isHoloID, isStreamer, isTl } from './commentBooleans'
import { GuildSettings, WatchFeature, WatchFeatureSettings } from '../../core/db/models'
import { ChatComment, Entry, Entries, Blacklist } from './chatRelayer'
import { AddChatItemAction, runsToString, MasterchatError, Masterchat } from 'masterchat'

export default (input: ChatWorkerInput): void => {
  allEntries = input.allEntries
  let wentLive = false
  input.port.on ('message', (msg: any) => { // TODO: refine any
    if (msg._tag === 'EntryUpdate') {
      allEntries = msg.entries
    }
    if (msg._tag === 'FrameUpdate') { // TODO: don't mutate input
      if (input.frame.status === 'upcoming' && msg.status === 'live') {
        wentLive = true
        chat.stop()
      }
      input.frame.status = msg.status
    }
  })
  const chat =
    new Masterchat (input.frame.id, input.frame.channel.id, { mode: 'live' })

  chat.on ('chats', async chats => {
    const cmtTasks = await processComments (input.frame, toChatComments (chats))
    cmtTasks.forEach (task => input.port.postMessage (task))
  })

  chat.on ('error', err => input.port.postMessage ({
    _tag: 'EndTask',
    frame: input.frame,
    errorCode: err instanceof MasterchatError ? err.code : undefined
  }))

  chat.on ('end', () => {
    input.port.postMessage ({
      _tag: 'EndTask', frame: input.frame, wentLive
    })
  })

  chat.listen ({ ignoreFirstResponse: true })
}

interface ChatWorkerInput {
  port: any // figure out why MessagePort type is broken
  frame: DexFrame
  allEntries: Entries
}

interface LogCommentTask {
  _tag: 'LogCommentTask'
  cmt: ChatComment
  frame: DexFrame
  streamer?: Streamer
}

interface SendMessageTask {
  _tag: 'SendMessageTask'
  cid: Snowflake
  content: string
  tlRelay: boolean
  vId: string
  g: GuildSettings
  save?: Omit<SaveMessageTask, '_tag'|'type'>
}

interface SaveMessageTask {
  _tag: 'SaveMessageTask'
  comment: ChatComment
  frame: DexFrame
  type: 'guild' | 'bot'
  msgId?: Snowflake
  chId?: Snowflake
}

interface EndTask {
  _tag: 'EndTask'
  frame: DexFrame
  errorCode?: string
  wentLive?: boolean
}

export type Task
  = SendMessageTask
  | SaveMessageTask
  | LogCommentTask
  | EndTask

///////////////////////////////////////////////////////////////////////////////

let allEntries: Entries = []


function toChatComments (chats: AddChatItemAction[]): ChatComment[] {
  return chats.map (chat => ({
    id: chat.authorChannelId,
    name: chat.authorName,
    body: runsToString (chat.rawMessage, { spaces:true }),
    time: chat.timestamp.getTime(),
    isMod: chat.isModerator,
    isOwner: chat.isOwner
  }))
}

export async function processComments (
  frame: DexFrame, cmts: ChatComment[]
): Promise<Task[]> {
  const tasks = await Promise.all (cmts.flatMap (async cmt => {
    const isTl_       = cmt.isTl || isTl (cmt.body)
    const isStreamer_ = cmt.isV || isStreamer (cmt.id)
    const streamer    = streamersMap.get (frame.channel.id)
    const author      = streamersMap.get (cmt.id)
    const isCameo     = isStreamer_ && !cmt.isOwner
    const mustDeepL   = isStreamer_ && !isHoloID (streamer)
    const deepLTl     = mustDeepL ? await tl (cmt.body) : undefined
    const mustShowTl  = mustDeepL && deepLTl !== cmt.body
    const maybeGossip = isStreamer_ || isTl_
    const entries     = allEntries.filter (([{}, {}, f, e]) =>
      [(f === 'cameos' ? author : streamer)?.name, 'all'].includes (e.streamer)
      || f === 'gossip'
    )

    const mustSave = isTl_ || isStreamer_

    const saveTask: SaveMessageTask = {
      _tag: 'SaveMessageTask',
      comment: cmt,
      frame,
      type: 'bot'
    }

    const sendTasks = entries.map (([g, bl, f, e]) => {
      const getTask = match (f, {
        cameos: isCameo     ? relayCameo  : doNothing,
        gossip: maybeGossip ? relayGossip : doNothing,
        relay:  relayTlOrStreamerComment
      })

      return getTask ({
        e, bl, cmt, frame, g,
        discordCh: e.discordCh,
        deepLTl:   mustShowTl ? deepLTl : undefined,
        to:        streamer?.name ?? 'Discord',
      })
    }).filter (x => x !== undefined) as Task[]

    return [...sendTasks, ...(mustSave ? [saveTask] : [])]
  }))

  return tasks.flat ()
}

function relayCameo (
  { discordCh, to, cmt, deepLTl, frame, g }: RelayData, isGossip?: boolean
): SendMessageTask {
  const cleaned = cmt.body.replaceAll ('`', "'")
  const stalked = streamers.find (s => s.ytId === cmt.id)
  const groups  = stalked?.groups as string[]|undefined
  const camEmj  = groups?.includes ('Nijisanji') ? emoji.niji : emoji.holo
  const emj     = isGossip ? emoji.peek : camEmj
  const mustTl  = deepLTl && g.deepl
  const line1   = `${emj} **${cmt.name}** in **${to}**'s chat: \`${cleaned}\``
  const line2   = mustTl ? `\n${emoji.deepl}**DeepL:** \`${deepLTl}\`` : ''
  const line3   = `\n<https://youtu.be/${frame.id}>`
  return {
    _tag: "SendMessageTask",
    cid: discordCh,
    content: line1 + line2 + line3,
    tlRelay: false,
    vId: frame.id,
    g: g
  }
}

function relayGossip (
  data: RelayData
): SendMessageTask|undefined {
  const stalked = streamers.find (s => s.name === data.e.streamer)
  return (isGossip (data.cmt.body, stalked!, data.frame))
    ? relayCameo (data, true)
    : undefined
}

function relayTlOrStreamerComment (
  { discordCh, bl, deepLTl, cmt, g, frame }: RelayData
): Task|undefined {
  const mustPost = cmt.isOwner
                || (isTl (cmt.body, g) && !isBlacklistedOrUnwanted (cmt, g, bl))
                || isStreamer (cmt.id)
                || (cmt.isMod && g.modMessages && !isBlacklistedOrUnwanted (cmt, g, bl))

  const vauthor = streamersMap.get (cmt.id)
  const groups  = vauthor?.groups as string[]|undefined
  const vemoji  = groups?.includes ('Nijisanji') ? emoji.niji : emoji.holo
  const premoji = isTl (cmt.body, g)  ? ':speech_balloon:'
                : isStreamer (cmt.id) ? vemoji
                                      : ':tools:'

  const url = frame.status === 'live' ? ''
            : deepLTl                 ? `\n<https://youtu.be/${frame.id}>`
                                      : ` | <https://youtu.be/${frame.id}>`

  const author = isTl (cmt.body, g) ? `||${cmt.name}:||` : `**${cmt.name}:**`
  const text   = cmt.body.replaceAll ('`', "''")
  const tl     = deepLTl && g.deepl
    ? `\n${emoji.deepl}**DeepL:** \`${deepLTl}\``
    : ''

  return mustPost
    ? {
      _tag: 'SendMessageTask',
      vId: frame.id,
      g,
      tlRelay: true,
      cid: discordCh,
      content: `${premoji} ${author} \`${text}\`${tl}${url}`,
      save: {
        comment: cmt,
        frame
      }
    }
    : undefined
}

function isGossip (text: string, stalked: Streamer, frame: DexFrame): boolean {
  const isOwnChannel = frame.channel.id === stalked.ytId
  const isCollab =
    [stalked.twitter, stalked.ytId, stalked.name, stalked.chName]
      .some (str => frame.description.includes (str))
  const mentionsWatched = text
    .replace(/[,()]|'s/g, '')
    .split (' ')
    .some (w => stalked.aliases.some (a => ciEquals (a, w)))
  
  return !isOwnChannel && !isCollab && mentionsWatched
}

interface RelayData {
  discordCh: Snowflake
  deepLTl?:  string
  bl:        Blacklist
  cmt:       ChatComment
  g:         GuildSettings
  frame:     DexFrame
  to:        StreamerName
  e:         WatchFeatureSettings
}
