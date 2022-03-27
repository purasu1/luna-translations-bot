import { Command, createEmbedMessage, reply } from '../../helpers/discord'
import { oneLine } from 'common-tags'
import { getSettings, updateSettings, removeBlacklisted } from '../db/functions'
import { CommandInteraction, Message } from 'discord.js'
import { head, init, last, isEmpty, isNil } from 'ramda'
import { SlashCommandBuilder } from '@discordjs/builders'

const description =
  'Unblacklists the specified channel ID.  If none specified, unblacklists last item.'

export const unblacklist: Command = {
  config: {
    permLevel: 1,
  },
  help: {
    category: 'Relay',
    description,
  },
  slash: new SlashCommandBuilder()
    .setName('unblacklist')
    .setDescription(description)
    .addStringOption((option) => option.setName('ytchannelid').setDescription('YT Channel ID')),
  callback: (intr: CommandInteraction): void => {
    const ytChannel = intr.options.getString('ytchannelid')
    const processMsg = isNil(ytChannel) ? unblacklistLastItem : unblacklistItem
    processMsg(intr, ytChannel!)
  },
}

///////////////////////////////////////////////////////////////////////////////

function unblacklistLastItem(intr: CommandInteraction): void {
  const { blacklist } = getSettings(intr)
  const lastBlacklisted = last(blacklist)
  const replyContent = lastBlacklisted
    ? oneLine`
      :white_check_mark: Successfully unblacklisted channel
      ${lastBlacklisted.ytId} (${lastBlacklisted.name}).
    `
    : ':warning: No items in blacklist.'

  reply(intr, createEmbedMessage(replyContent))
  if (lastBlacklisted) updateSettings(intr, { blacklist: init(blacklist) })
}

function unblacklistItem(intr: CommandInteraction, ytId: string): void {
  const success = removeBlacklisted(intr.guild!, ytId)
  reply(
    intr,
    createEmbedMessage(
      success
        ? `:white_check_mark: Successfully unblacklisted ${ytId}.`
        : `:warning: YouTube channel ID ${ytId} was not found.`,
    ),
  )
}
