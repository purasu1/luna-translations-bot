import { ciEquals, doNothing, match } from '../../helpers'
import { DexFrame } from '../holodex/frames'
import { Streamer, StreamerName, streamers } from '../../core/db/streamers'
import { emoji } from '../../helpers/discord'
import { Snowflake } from 'discord.js'
import { tl } from '../deepl'
import { isBlacklistedOrUnwanted, isHoloID, isStreamer, isTl } from './commentBooleans'
import { GuildSettings, WatchFeature, WatchFeatureSettings } from '../../core/db/models'
import { ChatComment } from './chatRelayer'

export default (input: ChatWorkerInput): Promise<Task[]> => {
  allEntries = input.allEntries
  return processComments (input.frame, input.cmts)
}

interface ChatWorkerInput {
  frame: DexFrame
  cmts: ChatComment[]
  allEntries: [GuildSettings, WatchFeature, WatchFeatureSettings][]
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

export type Task = SendMessageTask | SaveMessageTask | LogCommentTask

///////////////////////////////////////////////////////////////////////////////

let allEntries: [GuildSettings, WatchFeature, WatchFeatureSettings][] = []

async function processComments (
  frame: DexFrame, cmts: ChatComment[]
): Promise<Task[]> {
  const tasks = await Promise.all (cmts.flatMap (async cmt => {
    const streamer    = streamers.find (s => s.ytId === frame.channel.id)
    const author      = streamers.find (s => s.ytId === cmt.id)
    const isCameo     = isStreamer (cmt.id) && !cmt.isOwner
    const mustDeepL   = isStreamer (cmt.id) && !isHoloID (streamer)
    const deepLTl     = mustDeepL ? await tl (cmt.body) : undefined
    const mustShowTl  = mustDeepL && deepLTl !== cmt.body
    const maybeGossip = isStreamer (cmt.id) || isTl (cmt.body)
    const entries     = allEntries.filter (([{}, f, e]) =>
      [(f === 'cameos' ? author : streamer)?.name, 'all'].includes (e.streamer)
      || f === 'gossip'
    )

    const logTask: LogCommentTask = {
      _tag: 'LogCommentTask', cmt, frame, streamer
    }

    const mustSave = isTl (cmt.body) || isStreamer (cmt.id)

    const saveTask: SaveMessageTask = {
      _tag: 'SaveMessageTask',
      comment: cmt,
      frame,
      type: 'bot'
    }

    const sendTasks = entries.map (([g, f, e]) => {
      const getTask = match (f, {
        cameos: isCameo     ? relayCameo  : doNothing,
        gossip: maybeGossip ? relayGossip : doNothing,
        relay:  relayTlOrStreamerComment
      })

      return getTask ({
        e, cmt, frame, g,
        discordCh: e.discordCh,
        deepLTl:   mustShowTl ? deepLTl : undefined,
        to:        streamer?.name ?? 'Discord',
      })
    }).filter (x => x !== undefined) as Task[]

    return [logTask, ...sendTasks, ...(mustSave ? [saveTask] : [])]
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
  const line1   = `${emj} **${cmt.name}** in **${to}**'s chat: \`${cleaned}\``
  const line2   = deepLTl ? `\n${emoji.deepl}**DeepL:** \`${deepLTl}\`` : ''
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
  { discordCh, deepLTl, cmt, g, frame }: RelayData
): Task|undefined {
  const mustPost = cmt.isOwner
                || (isTl (cmt.body, g) && !isBlacklistedOrUnwanted (cmt, g))
                || isStreamer (cmt.id)
                || (cmt.isMod && g.modMessages && !isBlacklistedOrUnwanted (cmt, g))

  const vauthor = streamers.find (s => s.ytId === cmt.id)
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
  const tl     = deepLTl ? `\n${emoji.deepl}**DeepL:** \`${deepLTl}\`` : ''

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
  cmt:       ChatComment
  g:         GuildSettings
  frame:     DexFrame
  to:        StreamerName
  e:         WatchFeatureSettings
}
