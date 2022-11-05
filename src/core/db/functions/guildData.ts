import { DocumentType } from '@typegoose/typegoose'
import { Guild, Snowflake } from 'discord.js'
import { Map as ImmutableMap } from 'immutable'
import { UpdateQuery } from 'mongoose'
import { head, zip } from 'ramda'
import { snowflakeToUnix, isGuild } from '../../../helpers/discord'
import { deleteKey, filter, setKey } from '../../../helpers/immutableES6MapFunctions'
import { VideoId } from '../../../modules/holodex/frames'
import { client } from '../../lunaBotClient'
import { RelayedComment } from '../models/RelayedComment'
import { GuildData, BlacklistNotice, GuildDataDb } from '../models/GuildData'
import { YouTubeChannelId } from '../../../modules/holodex/frames'
import { debug } from '../../../helpers'

export type ImmutableRelayHistory = ImmutableMap<VideoId, RelayedComment[]>

export async function getAllRelayHistories(): Promise<ImmutableMap<Snowflake, ImmutableRelayHistory>> {
  const datas = await Promise.all(client.guilds.cache.map(getGuildData))
  const snowflakes = datas.map((g) => g._id)
  const histories = datas.map((g) => ImmutableMap(g.relayHistory))
  return ImmutableMap(zip(snowflakes, histories))
}

export async function getGuildRelayHistory(g: Guild | Snowflake, videoId: VideoId): Promise<RelayedComment[]>
export async function getGuildRelayHistory(g: Guild | Snowflake): Promise<ImmutableRelayHistory>
export async function getGuildRelayHistory(
  g: Guild | Snowflake,
  videoId?: VideoId,
): Promise<RelayedComment[] | ImmutableRelayHistory> {
  const data = await getGuildData(g)
  return videoId ? data.relayHistory.get(videoId) ?? [] : ImmutableMap(data.relayHistory)
}

export async function getRelayNotices(g: Guild | Snowflake): Promise<ImmutableMap<VideoId, Snowflake>> {
  const data = await getGuildData(g)
  return ImmutableMap (data.relayNotices)
}

export async function addRelayNotice (
  g: Guild | Snowflake, videoId: VideoId, msgId: Snowflake
): Promise<void> {
  const data = await getGuildData(g)
  const newNotices =  setKey(videoId, msgId)(data.relayNotices)
  updateGuildData (g, { relayNotices: newNotices })
}

export async function findVidIdAndCulpritByMsgId (
  g: Guild | Snowflake | null, msgId: Snowflake
): Promise<[VideoId | undefined, RelayedComment | undefined]> {
  const histories = g ? await getGuildRelayHistory (g) : undefined
  const predicate = (cs: RelayedComment[]) => cs.some((c) => c.msgId === msgId)
  const vidId = histories?.findKey(predicate)
  const history = histories?.find(predicate)
  const culprit = history?.find((c) => c.msgId === msgId)
  return [vidId, culprit]
}

export async function getFlatGuildRelayHistory (
  g: Guild | Snowflake
): Promise<RelayedComment[]> {
  const histories = await getGuildRelayHistory (g)
  return histories.toList ().toArray ().flat ()
}

export async function addToGuildRelayHistory (
  videoId: VideoId, cmt: RelayedComment, g: Guild | Snowflake
): Promise<void> {
  debug('adding to guild relay history...')
  debug('getting guild data...')
  const history    = (await getGuildData (g)).relayHistory
  debug('got guild data.')
  const cmts = history.get(videoId) ?? []
  const newHistory = setKey(videoId, [...cmts, cmt])(history)
  debug('updating guild data...')
  updateGuildData(g, { relayHistory: newHistory })
  debug('updated guild data.')
  debug('...done adding to guild relay history')
}

export async function deleteRelayHistory (
  videoId: VideoId, g: Guild | Snowflake
): Promise<void> {
  const history = (await getGuildData (g)).relayHistory
  updateGuildData(g, { relayHistory: deleteKey(videoId)(history) })
}

export async function addBlacklistNotice (
  { g, msgId, ytId, videoId, originalMsgId }: NewBlacklistNoticeProps
): Promise<void> {
  const notices = (await getGuildData (g)).blacklistNotices
  const newNotice = { ytId, videoId, originalMsgId }
  updateGuildData(g, { blacklistNotices: setKey(msgId, newNotice)(notices) })
}

export async function getNoticeFromMsgId (
  g: Guild | Snowflake, msgId: Snowflake
): Promise<BlacklistNotice | undefined> {
  return (await getGuildData (g)).blacklistNotices.get (msgId)
}

export async function excludeLine (
  g: Guild | Snowflake, videoId: VideoId, msgId: Snowflake
): Promise<void> {
  const history = (await getGuildData (g)).relayHistory
  const vidLog = history.get(videoId) ?? []
  const culprit = vidLog.findIndex((cmt) => cmt.msgId === msgId)
  const vidHistory = [...vidLog.slice(0, culprit), ...vidLog.slice(culprit)]
  const relayHistory = setKey(videoId, vidHistory)(history)
  if (vidLog.length > 0) updateGuildData(g, { relayHistory })
}

export type NewData = UpdateQuery<DocumentType<GuildData>>

export async function updateGuildData (
  g: Guild | Snowflake, update: NewData
): Promise<DocumentType<GuildData>> {
  const _id = isGuild (g) ? g.id : g
  return GuildDataDb
    .findOneAndUpdate ({ _id }, update, {upsert: true, new: true })
}

export async function getGuildData (g: Guild | Snowflake): Promise<GuildData> {
  const _id = isGuild (g) ? g.id : g
  const query = [{ _id }, { _id }, { upsert: true, new: true }] as const
  return GuildDataDb.findOneAndUpdate (...query)
}

export async function clearOldData(): Promise<void> {
  debug('clearing old data...')
  const now = new Date().getTime()
  const WEEK = 7 * 24 * 60 * 60 * 1000
  const isRecentHist = (v: RelayedComment[]) =>
    !!head(v)?.msgId && snowflakeToUnix(head(v)!.msgId!) - now < WEEK
  const isRecentK = (_: BlacklistNotice, k: Snowflake) => snowflakeToUnix(k) - now < WEEK
  const isRecentV = (v: Snowflake) => snowflakeToUnix(v) - now < WEEK

  client.guilds.cache.forEach(async (g) => {
    debug('clearing for guild '+ g.id)
    const guildData = await getGuildData(g)
    const newRelayNotices = filter(guildData.relayNotices, isRecentV)
    const newBlacklistNotices = filter(guildData.blacklistNotices, isRecentK)
    const newRelayHistory = filter(guildData.relayHistory, isRecentHist)
    debug('finished computing new stuff')

    debug('updating guild data 1/1')
    updateGuildData(guildData._id, {
      relayNotices: newRelayNotices,
      relayHistory: newRelayHistory,
      blacklistNotices: newBlacklistNotices,
    })
    debug('done with guild ' + g.id)
  })
  debug('done clearing')
}

export function deleteGuildData(g: Snowflake): void {
  // temporarily deleted to not use enmap
}

///////////////////////////////////////////////////////////////////////////////

interface NewBlacklistNoticeProps {
  g: Guild | Snowflake
  msgId: Snowflake | undefined
  ytId: YouTubeChannelId
  videoId: VideoId
  originalMsgId: Snowflake
}
