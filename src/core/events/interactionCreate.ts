import {
  Interaction,
  ButtonInteraction,
  Snowflake,
  CommandInteraction,
  GuildMember,
  ContextMenuInteraction,
} from 'discord.js'
import { doNothing, match, isNotNil, log } from '../../helpers'
import { Command, createEmbedMessage, findTextChannel } from '../../helpers/discord'
import {
  getNoticeFromMsgId,
  removeBlacklisted,
  excludeLine,
  getGuildRelayHistory,
  getPermLevel,
} from '../db/functions'
import { BlacklistNotice } from '../db/models/GuildData'
import { oneLine } from 'common-tags'
import { last, isNil } from 'ramda'
import { tryOrLog } from '../../helpers/tryCatch'
import { reply, createEmbed } from '../../helpers/discord'
import { commands } from '../lunaBotClient'

export async function interactionCreate(intr: Interaction): Promise<void> {
  if (!intr.inGuild()) return
  (intr as any).deferReply?.()
  if (intr.isButton()) tryOrLog(() => processButton(intr as any))
  if (intr.isCommand() || intr.isContextMenu()) {
    if (await isAuthorTooLowLevel(intr.commandName, intr.member as GuildMember)) {
      reply(
        intr,
        createEmbed({
          title: 'Insufficient permissions',
          description:
            "you don't have the right, O you don't have the right, therefore you don't have the right, O you don't have the right",
        }),
      )
    } else {
      // Not sure if this is safe
      runRequestedCommand(intr as CommandInteraction)
    }
  }
}

///////////////////////////////////////////////////////////////////////////////

function runRequestedCommand(intr: CommandInteraction): void {
  const command = findCommand(intr.commandName)

  log(oneLine`
    ${intr.user.username} (${intr.user.id}) ran ${intr.commandName}
    in server ${intr.guild!.name} (${intr.guild!.id})
  `)

  command!.callback(intr)
}
async function isAuthorTooLowLevel(cmd: string, member: GuildMember): Promise<boolean> {
  const authorLevel = await getAuthorPermLevel(member)
  const command = findCommand(cmd)

  return authorLevel < command!.config.permLevel
}

async function getAuthorPermLevel(member: GuildMember): Promise<number> {
  const authorPerm = await getPermLevel(member)
  return authorPerm.level
}

function findCommand(cmd?: string): Command | undefined {
  return isNil(cmd) ? undefined : commands.get(cmd)
}

function processButton(btn: ButtonInteraction): void {
  const notice = getNoticeFromMsgId(btn.guild!, btn.message.id)
  const btnHandler = notice
    ? match(btn.customId, {
        cancel: cancelBlacklisting,
        cancel2: cancelBlacklistingAndExcludeLine,
        clear: clearAuthorTls,
      })
    : doNothing

  btnHandler(btn, notice)
}

async function cancelBlacklisting(btn: ButtonInteraction, notice: BlacklistNotice): Promise<void> {
  const success = removeBlacklisted(btn.guild!, notice.ytId)
  tryOrLog(() =>
    btn.update({
      components: [],
      embeds: [
        createEmbedMessage(
          success
            ? `${notice?.ytId}'s blacklisting has been cancelled.`
            : `Something went wrong unblacklisting ${notice?.ytId}.`,
        ),
      ],
    }),
  )
}

async function cancelBlacklistingAndExcludeLine(
  btn: ButtonInteraction,
  notice: BlacklistNotice,
): Promise<void> {
  removeBlacklisted(btn.guild!, notice.ytId)
  excludeLine(btn.guild!, notice.videoId, notice.originalMsgId)
  tryOrLog(() =>
    btn.update({
      components: [],
      embeds: [
        createEmbedMessage(oneLine`
    ${notice?.ytId}'s blacklisting has been cancelled but the deleted message
    will not be in the final log.
  `),
      ],
    }),
  )
}

function clearAuthorTls(btn: ButtonInteraction, notice: BlacklistNotice): void {
  const vidLog = getGuildRelayHistory(btn.guild!, notice.videoId)
  const cmts = vidLog.filter((cmt) => cmt.ytId === notice.ytId)
  const msgs = <Snowflake[]>cmts.map((cmt) => cmt.msgId).filter(isNotNil)
  const ch = findTextChannel(last(cmts)?.discordCh ?? '')

  ch?.bulkDelete(msgs)
    .then((deleted) =>
      tryOrLog(() =>
        btn.update({
          components: [],
          embeds: [createEmbedMessage(`Deleted ${deleted.size} translations.`)],
        }),
      ),
    )
    .catch((_) =>
      tryOrLog(() =>
        btn.update({
          components: [],
          embeds: [createEmbedMessage('I need Manage Messages permissions.')],
        }),
      ),
    )
}
